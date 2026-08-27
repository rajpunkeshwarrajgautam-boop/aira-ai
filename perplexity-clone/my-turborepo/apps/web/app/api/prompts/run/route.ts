import { z } from "zod";

import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import {
	promptProviderDescriptors,
	runPromptTarget,
	type PromptProviderId,
	type PromptRunEvent,
	type PromptRunTarget,
} from "@/lib/prompts/prompt-execution";
import { getPromptDetail, getPromptVersion } from "@/lib/prompts/prompt-registry";
import { canTestPromptVersion } from "@services/prompt/prompt-authorization";
import { parseVariableDefinitions } from "@services/prompt/prompt-variables";
import {
	assertSafetyAllowed,
	SafetyBlockedError,
} from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Wall-clock ceiling per target so one hung provider cannot hold the stream. */
const TARGET_TIMEOUT_MS = 90_000;

const TargetSchema = z.object({
	promptId: z.string().trim().min(3).max(128),
	versionId: z.string().trim().min(3).max(128),
	provider: z.enum(["openai", "nvidia", "omniroute"]),
	model: z.string().trim().min(1).max(500).optional(),
});

const RunSchema = z.object({
	message: z.string().trim().min(1).max(12_000),
	variables: z.record(z.string().max(48), z.string().max(4_000)).optional(),
	targets: z.array(TargetSchema).min(1).max(3),
});

export async function GET(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	return noStoreJson({ providers: promptProviderDescriptors() });
}

/**
 * Runs one to three prompt-version targets against the same message.
 *
 * A single target is the Test Playground; two or three is Prompt Compare —
 * v1 vs v2 on one model, one version across models, or different prompts side
 * by side. Targets are launched together and each publishes its own lifecycle
 * events, so a failure, timeout or unconfigured provider ends that target only.
 *
 * Draft versions are allowed here (that is the point of a playground) but every
 * target is ownership-checked server-side before it runs.
 */
export async function POST(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, RunSchema);
	if (!body.ok) return body.response;

	try {
		await assertSafetyAllowed("input", body.data.message);
	} catch (error) {
		if (error instanceof SafetyBlockedError) {
			return noStoreJson({ error: { code: "SAFETY_BLOCKED", message: error.message } }, { status: 400 });
		}
		return noStoreJson(
			{ error: { code: "SAFETY_UNAVAILABLE", message: "AIRA's safety gateway is unavailable." } },
			{ status: 503 },
		);
	}

	const seen = new Set<string>();
	const targets: PromptRunTarget[] = [];
	try {
		for (const target of body.data.targets) {
			const prompt = await getPromptDetail(session.userId, target.promptId);
			const decision = canTestPromptVersion(
				{ userId: session.userId },
				{ ownerUserId: prompt.userId, status: prompt.status, visibility: prompt.visibility },
			);
			if (!decision.allowed) {
				return noStoreJson(
					{ error: { code: decision.code, message: decision.message } },
					{ status: decision.status },
				);
			}

			const version = await getPromptVersion(session.userId, target.promptId, target.versionId);
			const targetId = `${target.provider}:${target.model ?? "default"}:${version.id}`;
			if (seen.has(targetId)) {
				return noStoreJson(
					{ error: { code: "DUPLICATE_TARGET", message: "Choose distinct comparison targets." } },
					{ status: 400 },
				);
			}
			seen.add(targetId);

			targets.push({
				targetId,
				providerId: target.provider as PromptProviderId,
				model: target.model,
				template: {
					promptId: prompt.id,
					versionId: version.id,
					version: version.version,
					name: prompt.name,
					body: version.body,
					variables: parseVariableDefinitions(version.variables),
					values: body.data.variables ?? {},
				},
			});
		}
	} catch (error) {
		return promptErrorResponse(error, "run-resolve");
	}

	const encoder = new TextEncoder();
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const publish = (event: PromptRunEvent) => {
				if (cancelled) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					cancelled = true;
				}
			};

			void Promise.all(
				targets.map((target) =>
					runPromptTarget(
						target,
						{
							userMessage: body.data.message,
							abortSignal: req.signal,
							timeoutMs: TARGET_TIMEOUT_MS,
						},
						publish,
					),
				),
			).finally(() => {
				if (cancelled) return;
				try {
					controller.close();
				} catch {
					cancelled = true;
				}
			});
		},
		cancel() {
			cancelled = true;
		},
	});

	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

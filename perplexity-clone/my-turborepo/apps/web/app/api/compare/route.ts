import { z } from "zod";

import { auth } from "@/auth";
import { BillingPlan } from "@/generated/prisma/enums";
import {
	assertMinPlan,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { fetchOmniRouteModels, OmniRouteGatewayError } from "@services/omniroute/gateway";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import {
	isAllowedOmniRouteSelection,
	isOmniRouteRoutingMode,
	OMNIROUTE_ROUTING_MODES,
} from "@services/omniroute/routing";
import { NVIDIAProvider } from "@services/providers/nvidia-provider";
import { OmniRouteProvider } from "@services/providers/omniroute-provider";
import { OpenAIProvider } from "@services/providers/openai-provider";
import { ProviderRouter } from "@services/providers/provider-router";
import {
	assertSafetyAllowed,
	SafetyBlockedError,
	SafetyGatewayError,
} from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ProviderId = "openai" | "nvidia" | "omniroute";
type CompareTarget = { provider: ProviderId; model?: string };

type CompareStreamEvent =
	| {
			type: "start";
			targetId: string;
			providerId: ProviderId;
			model: string;
		}
	| {
			type: "delta";
			targetId: string;
			delta: string;
		}
	| {
			type: "complete";
			targetId: string;
			providerId: ProviderId;
			model: string;
			text: string;
			latencyMs: number;
		}
	| {
			type: "error";
			targetId: string;
			providerId: ProviderId;
			model: string;
			error: string;
		};

type PublishCompareEvent = (event: CompareStreamEvent) => void;

const TargetSchema = z.object({
	provider: z.enum(["openai", "nvidia", "omniroute"]),
	model: z.string().trim().min(1).max(500).optional(),
});

const CompareSchema = z.object({
	prompt: z.string().trim().min(2).max(12_000),
	targets: z.array(TargetSchema).min(2).max(3),
});

function descriptors() {
	const omniRoute = getOmniRouteConfigOrDisabled();
	return [
		{
			id: "omniroute" as const,
			label: "OmniRoute",
			configured: omniRoute.configured,
			model: omniRoute.model,
			routingModes: OMNIROUTE_ROUTING_MODES,
		},
		{
			id: "openai" as const,
			label: "OpenAI",
			configured: Boolean(process.env.OPENAI_API_KEY),
			model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
		},
		{
			id: "nvidia" as const,
			label: "NVIDIA",
			configured: Boolean(process.env.NVIDIA_API_KEY),
			model: process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-70b-instruct",
		},
	];
}

function createRouter(id: ProviderId): ProviderRouter | null {
	const router = new ProviderRouter(id, id);
	if (id === "omniroute") {
		const omniRoute = getOmniRouteConfigOrDisabled();
		if (!omniRoute.configured) return null;
		router.registerProvider(
			new OmniRouteProvider({
				baseURL: omniRoute.baseURL,
				apiKey: omniRoute.apiKey,
				model: omniRoute.model,
				timeoutMs: omniRoute.timeoutMs,
			}),
		);
		return router;
	}
	if (id === "openai" && process.env.OPENAI_API_KEY) {
		router.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));
		return router;
	}
	if (id === "nvidia" && process.env.NVIDIA_API_KEY) {
		router.registerProvider(new NVIDIAProvider(process.env.NVIDIA_API_KEY));
		return router;
	}
	return null;
}

function publicProviderError(error: unknown): string {
	if (error instanceof SafetyBlockedError) return error.message;
	if (error instanceof SafetyGatewayError) return "AIRA's safety gateway is unavailable.";
	if (error instanceof OmniRouteGatewayError) return error.message;
	const status =
		typeof error === "object" && error !== null && "status" in error
			? (error as { readonly status?: unknown }).status
			: undefined;
	if (status === 401 || status === 403) return "The provider rejected AIRA's credentials.";
	if (status === 429) return "The provider is temporarily rate limited.";
	if (status === 404) return "The selected model is unavailable.";
	return "Provider request failed.";
}

async function requireCompareAccess(userId: string): Promise<Response | null> {
	try {
		await assertMinPlan(userId, BillingPlan.PRO);
		return null;
	} catch (error) {
		if (error instanceof PlanEnforcementError) {
			return Response.json(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		throw error;
	}
}

function resolvedTarget(target: CompareTarget): {
	readonly descriptor: ReturnType<typeof descriptors>[number] | undefined;
	readonly model: string;
	readonly targetId: string;
} {
	const descriptor = descriptors().find((entry) => entry.id === target.provider);
	const model = target.model?.trim() || descriptor?.model || "default";
	return { descriptor, model, targetId: `${target.provider}:${model}` };
}

async function runTarget(
	target: CompareTarget,
	prompt: string,
	publish: PublishCompareEvent,
): Promise<void> {
	const router = createRouter(target.provider);
	const { model, targetId } = resolvedTarget(target);
	publish({ type: "start", targetId, providerId: target.provider, model });

	if (!router) {
		publish({
			type: "error",
			targetId,
			providerId: target.provider,
			model,
			error: "Provider is not configured.",
		});
		return;
	}

	let text = "";
	const startedAt = Date.now();
	try {
		for await (const delta of router.streamChat(
			[
				{
					role: "system",
					content:
						"You are participating in AIRA's model comparison workspace. Answer the user's prompt directly and independently. Do not claim web access unless the prompt itself provides sources. Prefer accuracy, explicit uncertainty, and useful structure.",
				},
				{ role: "user", content: prompt },
			],
			{ model, temperature: 0.2, maxCompletionTokens: 1600 },
		)) {
			text += delta;
			publish({ type: "delta", targetId, delta });
		}
		publish({
			type: "complete",
			targetId,
			providerId: target.provider,
			model,
			text,
			latencyMs: Date.now() - startedAt,
		});
	} catch (error) {
		publish({
			type: "error",
			targetId,
			providerId: target.provider,
			model,
			error: publicProviderError(error),
		});
	}
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	const accessError = await requireCompareAccess(session.user.id);
	if (accessError) return accessError;
	return Response.json(
		{ providers: descriptors() },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	const accessError = await requireCompareAccess(session.user.id);
	if (accessError) return accessError;

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json(
			{ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } },
			{ status: 400 },
		);
	}

	const parsed = CompareSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: "Choose two or three configured model targets and enter a prompt.",
				},
			},
			{ status: 400 },
		);
	}

	const uniqueKeys = new Set(
		parsed.data.targets.map((target) => `${target.provider}:${target.model ?? ""}`),
	);
	if (uniqueKeys.size !== parsed.data.targets.length) {
		return Response.json(
			{ error: { code: "DUPLICATE_TARGET", message: "Choose distinct comparison targets." } },
			{ status: 400 },
		);
	}

	try {
		await assertSafetyAllowed("input", parsed.data.prompt);
	} catch (error) {
		if (error instanceof SafetyBlockedError) {
			return Response.json(
				{ error: { code: "SAFETY_BLOCKED", message: error.message } },
				{ status: 400 },
			);
		}
		return Response.json(
			{
				error: {
					code: "SAFETY_UNAVAILABLE",
					message: "AIRA's safety gateway is unavailable.",
				},
			},
			{ status: 503 },
		);
	}

	const omniTargets = parsed.data.targets.filter((target) => target.provider === "omniroute");
	const fixedOmniModels = omniTargets
		.map((target) => target.model?.trim())
		.filter((model): model is string => Boolean(model) && !isOmniRouteRoutingMode(model!));
	if (fixedOmniModels.length > 0) {
		try {
			const snapshot = await fetchOmniRouteModels(req.signal);
			const discovered = snapshot.models.map((entry) => entry.id);
			const invalid = fixedOmniModels.find(
				(model) => !isAllowedOmniRouteSelection(model, discovered),
			);
			if (invalid) {
				return Response.json(
					{
						error: {
							code: "OMNIROUTE_MODEL_NOT_DISCOVERED",
							message:
								"One selected OmniRoute model is no longer present in the live registry.",
						},
					},
					{ status: 400, headers: { "Cache-Control": "no-store" } },
				);
			}
		} catch (error) {
			return Response.json(
				{
					error: {
						code: "OMNIROUTE_REGISTRY_UNAVAILABLE",
						message: publicProviderError(error),
					},
				},
				{ status: 502, headers: { "Cache-Control": "no-store" } },
			);
		}
	}

	const encoder = new TextEncoder();
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const publish: PublishCompareEvent = (event) => {
				if (cancelled) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					cancelled = true;
				}
			};

			void Promise.all(
				parsed.data.targets.map((target) => runTarget(target, parsed.data.prompt, publish)),
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

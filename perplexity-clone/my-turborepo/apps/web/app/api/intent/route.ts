import { z } from "zod";

import { auth } from "@/auth";
import {
	routeIntent,
	toIntentDecisionTelemetry,
	type IntentDecision,
} from "@/lib/intent-router";
import { createProject } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z
	.object({
		message: z.string().trim().min(1).max(16_000),
		timezone: z.string().trim().min(1).max(100).optional(),
	})
	.strict();

const SAFE_NATIVE_CAPABILITIES = new Set([
	"answer.generate",
	"research.web_search",
	"research.deep_research",
	"automation.create",
	"agent.plan",
]);

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

function directiveFor(
	decision: IntentDecision,
	options: { readonly workProjectId?: string } = {},
) {
	switch (decision.intent) {
		case "ANSWER":
		case "RESEARCH":
			return {
				type: "SEARCH" as const,
				mode: decision.executionSurface === "DEEP_RESEARCH" ? "deep" as const : "standard" as const,
			};
		case "AGENT_MISSION":
			return {
				type: "WORK_REVIEW" as const,
				href: options.workProjectId
					? `/work?intent=agent&projectId=${encodeURIComponent(options.workProjectId)}`
					: "/work?intent=agent",
				autoLaunch: false,
			};
		case "TOOL_ACTION":
			return {
				type: "TOOL_PREVIEW" as const,
				capabilities: decision.requiredCapabilities,
				requiresApproval: decision.requiresApproval,
				status: decision.fallbackReason ? "BLOCKED" as const : "READY" as const,
				reason: decision.fallbackReason ?? "Review the resolved action before execution.",
			};
		case "WORKFLOW":
		case "AUTOMATION_CREATE":
			return {
				type: "AUTOMATION_PREVIEW" as const,
				persistent: decision.intent === "AUTOMATION_CREATE",
				enabled: false,
				recurrence: decision.recurrence ?? null,
				capabilities: decision.requiredCapabilities,
				requiresApproval: true,
				status: decision.fallbackReason ? "BLOCKED" as const : "READY" as const,
				reason: decision.fallbackReason ?? "Preview only. Explicit activation is required.",
			};
	}
}

export async function POST(request: Request): Promise<Response> {
	const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json(
			{ error: { code: "VALIDATION_ERROR", message: "Intent request is invalid.", details: z.treeifyError(parsed.error) } },
			{ status: 400 },
		);
	}

	const routed = await routeIntent(parsed.data.message, {
		timezone: parsed.data.timezone ?? "UTC",
		availableCapabilities: SAFE_NATIVE_CAPABILITIES,
	});
	if (routed.kind === "EXPLICIT_COMMAND") {
		return json(
			{ error: { code: "EXPLICIT_COMMAND_REQUIRED", message: "Explicit commands must use the command registry." } },
			{ status: 409 },
		);
	}

	const telemetry = toIntentDecisionTelemetry(routed.decision);
	console.info("[AiraIntentRouter] decision", JSON.stringify(telemetry));

	let workProjectId: string | undefined;
	const initialDirective = directiveFor(routed.decision);
	if (initialDirective.type !== "SEARCH") {
		const session = await auth();
		if (!session?.user?.id) {
			return json(
				{
					error: { code: "UNAUTHENTICATED", message: "Sign in is required for actions, workflows, automations, and missions." },
					decision: routed.decision,
				},
				{ status: 401 },
			);
		}

		if (
			routed.decision.intent === "AGENT_MISSION" &&
			!routed.decision.fallbackReason
		) {
			const project = await createProject({
				userId: session.user.id,
				name: "Aira mission review",
				objective: parsed.data.message,
				config: {
					source: "intent-router",
					intent: "AGENT_MISSION",
					launchAuthorized: false,
				},
			});
			workProjectId = project.id;
			console.info(
				"[AiraExecutionRouter] handoff",
				JSON.stringify({
					intent: routed.decision.intent,
					executionSurface: routed.decision.executionSurface,
					projectId: project.id,
					autoLaunch: false,
				}),
			);
		}
	}

	const directive = directiveFor(routed.decision, { workProjectId });
	return json({ decision: routed.decision, directive });
}

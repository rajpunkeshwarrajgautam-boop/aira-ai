import { z } from "zod";

import { auth } from "@/auth";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import {
	agentRunStatusToStepStatus,
	recordAgentRunStepBestEffort,
} from "@/lib/agents/run-steps";
import {
	getAgentRuntimeStates,
	runtimeStatesById,
	selectAgentRuntime,
} from "@/lib/agent-runtime/registry";
import { parseRuntimePriority, selectRuntimeId } from "@/lib/agent-runtime/selection";
import { AgentRuntimeError, type AgentRuntimeId } from "@/lib/agent-runtime/types";
import { AutoGptRequestError } from "@/lib/autogpt/client";
import { AutoGptConfigError } from "@/lib/autogpt/config";
import { listAgentRuns } from "@/lib/autogpt/runs";
import {
	getEffectiveEntitlements,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { DeerFlowRequestError } from "@/lib/deerflow/client";
import { DeerFlowConfigError } from "@/lib/deerflow/config";
import {
	admitFoundationRequest,
	releaseFoundationLease,
} from "@/lib/foundation-control-plane";
import {
	assertSafetyAllowed,
	SafetyBlockedError,
	SafetyGatewayError,
} from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubmitRunSchema = z.object({
	clientRequestId: z.string().uuid(),
	objective: z.string().trim().min(3).max(4_000),
	provider: z.enum(["DEERFLOW", "AUTOGPT", "AGENT_SWARM"]).optional(),
});

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	const headers = new Headers(init?.headers);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, { ...init, headers });
}

function runtimeLabel(provider: string): string {
	if (provider === "DEERFLOW") return "DeerFlow 2.0";
	if (provider === "AUTOGPT") return "AutoGPT";
	if (provider === "AGENT_SWARM") return "Agent Swarm";
	return provider;
}

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	const requestedLimit = Number(new URL(req.url).searchParams.get("limit") ?? "20");
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
	const [runs, entitlements, states] = await Promise.all([
		listAgentRuns(session.user.id, limit),
		getEffectiveEntitlements(session.user.id),
		getAgentRuntimeStates(),
	]);
	let preferredProvider: AgentRuntimeId | null = null;
	try {
		preferredProvider = selectRuntimeId({
			states,
			priority: parseRuntimePriority(process.env.AIRA_AGENT_RUNTIME_PRIORITY),
		});
	} catch {
		preferredProvider = null;
	}
	return noStoreJson({
		runs,
		feature: {
			enabled: states.some((state) => state.enabled),
			configured: states.some((state) => state.configured),
			ready: states.some((state) => state.ready),
			preferredProvider,
			providers: runtimeStatesById(states),
		},
		usage: {
			billingPlan: entitlements.billingPlan,
			monthlyAgentRunLimit: entitlements.monthlyAgentRunLimit,
			agentRunsUsed: entitlements.agentRunsUsed,
			agentRunsRemaining: entitlements.agentRunsRemaining,
		},
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return noStoreJson(
			{ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } },
			{ status: 400 },
		);
	}
	const parsed = SubmitRunSchema.safeParse(body);
	if (!parsed.success) {
		return noStoreJson(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: "Enter an objective between 3 and 4,000 characters.",
					details: z.treeifyError(parsed.error),
				},
			},
			{ status: 400 },
		);
	}

	try {
		await assertSafetyAllowed("agent-objective", parsed.data.objective);
	} catch (error) {
		if (error instanceof SafetyBlockedError) {
			return noStoreJson(
				{ error: { code: "SAFETY_BLOCKED", message: "This autonomous objective cannot be processed by the configured safety policy." } },
				{ status: 403 },
			);
		}
		if (error instanceof SafetyGatewayError) {
			return noStoreJson(
				{ error: { code: "SAFETY_GATEWAY_UNAVAILABLE", message: "The required safety service is temporarily unavailable." } },
				{ status: 503 },
			);
		}
		throw error;
	}

	let leaseId: string | undefined;
	try {
		const selectedRuntime = await selectAgentRuntime(parsed.data.provider as AgentRuntimeId | undefined);
		const lease = await admitFoundationRequest({
			requestId: parsed.data.clientRequestId,
			kind: "agent",
		});
		if (!lease.allowed) {
			return noStoreJson(
				{
					error: {
						code: "AGENT_CAPACITY_BUSY",
						message: "AIRA's agent workers are at their current safe capacity. Please retry shortly.",
					},
				},
				{
					status: 503,
					headers: { "Retry-After": String(Math.max(1, Math.ceil((lease.retryAfterMs ?? 1000) / 1000))) },
				},
			);
		}
		leaseId = lease.leaseId;

		const submitted = await selectedRuntime.createRun({
			userId: session.user.id,
			clientRequestId: parsed.data.clientRequestId,
			objective: parsed.data.objective,
		});

		await Promise.all([
			recordAgentRunEventBestEffort({
				runId: submitted.run.id,
				eventKey: "submitted",
				type: "SUBMITTED",
				status: submitted.run.status,
				message: `Task accepted by ${runtimeLabel(submitted.run.provider)}.`,
				metadata: { provider: submitted.run.provider },
			}),
			recordAgentRunStepBestEffort({
				runId: submitted.run.id,
				stepKey: "provider-submission",
				type: "PROVIDER_SUBMISSION",
				label: `Submit task to ${runtimeLabel(submitted.run.provider)}`,
				status: "COMPLETED",
			}),
			recordAgentRunStepBestEffort({
				runId: submitted.run.id,
				stepKey: "provider-execution",
				type: "PROVIDER_EXECUTION",
				label: `${runtimeLabel(submitted.run.provider)} execution`,
				status: agentRunStatusToStepStatus(submitted.run.status),
			}),
		]);

		return noStoreJson(submitted, { status: 202 });
	} catch (error) {
		if (error instanceof PlanEnforcementError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		if (error instanceof AgentRuntimeError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message, retryable: error.retryable } },
				{ status: error.status },
			);
		}
		if (error instanceof DeerFlowConfigError || error instanceof AutoGptConfigError) {
			return noStoreJson(
				{ error: { code: error.code, message: "Autonomous agent tasks are not configured for this AIRA deployment." } },
				{ status: 503 },
			);
		}
		if (error instanceof DeerFlowRequestError || error instanceof AutoGptRequestError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message, retryable: error.retryable } },
				{ status: error.status },
			);
		}
		console.error("[agents:runs:create]", error);
		return noStoreJson(
			{ error: { code: "AGENT_SUBMISSION_FAILED", message: "The agent task could not be started." } },
			{ status: 500 },
		);
	} finally {
		await releaseFoundationLease(leaseId);
	}
}

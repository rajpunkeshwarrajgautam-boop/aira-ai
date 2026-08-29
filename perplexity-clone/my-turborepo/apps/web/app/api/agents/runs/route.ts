import { z } from "zod";

import { auth } from "@/auth";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import {
	agentRunStatusToStepStatus,
	recordAgentRunStepBestEffort,
} from "@/lib/agents/run-steps";
import { AutoGptRequestError } from "@/lib/autogpt/client";
import {
	AutoGptConfigError,
	isAutoGptConfigured,
	isAutoGptEnabled,
} from "@/lib/autogpt/config";
import { listAgentRuns, submitAgentRun } from "@/lib/autogpt/runs";
import {
	getEffectiveEntitlements,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { checkDeerFlowHealth, DeerFlowRequestError } from "@/lib/deerflow/client";
import {
	DeerFlowConfigError,
	getDeerFlowConfig,
	isDeerFlowConfigured,
	isDeerFlowEnabled,
} from "@/lib/deerflow/config";
import { submitDeerFlowAgentRun } from "@/lib/deerflow/runs";
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

type AgentProvider = "DEERFLOW" | "AUTOGPT";

const SubmitRunSchema = z.object({
	clientRequestId: z.string().uuid(),
	objective: z.string().trim().min(3).max(4_000),
	provider: z.enum(["DEERFLOW", "AUTOGPT"]).optional(),
});

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	const headers = new Headers(init?.headers);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, { ...init, headers });
}

function configuredProviderState() {
	return {
		deerFlow: {
			enabled: isDeerFlowEnabled(),
			configured: isDeerFlowConfigured(),
		},
		autoGpt: {
			enabled: isAutoGptEnabled(),
			configured: isAutoGptConfigured(),
		},
	};
}

async function deerFlowHealthy(configured: boolean): Promise<boolean> {
	if (!configured) return false;
	try {
		return await checkDeerFlowHealth(getDeerFlowConfig());
	} catch {
		return false;
	}
}

async function selectProvider(requested?: AgentProvider): Promise<AgentProvider> {
	const state = configuredProviderState();
	if (requested === "DEERFLOW") {
		if (!state.deerFlow.configured) {
			throw new DeerFlowConfigError("DeerFlow is not configured for this AIRA deployment.");
		}
		if (!(await deerFlowHealthy(true))) {
			throw new DeerFlowRequestError({
				code: "DEERFLOW_UNHEALTHY",
				message: "The DeerFlow SuperAgent runtime is temporarily unavailable.",
				status: 503,
				retryable: true,
			});
		}
		return "DEERFLOW";
	}
	if (requested === "AUTOGPT") {
		if (!state.autoGpt.configured) {
			throw new AutoGptConfigError("AutoGPT is not configured for this AIRA deployment.");
		}
		return "AUTOGPT";
	}

	// DeerFlow is AIRA's preferred long-horizon engine, but a failed health probe
	// must not strand the workspace when the already-hardened AutoGPT fallback is configured.
	if (state.deerFlow.configured && (await deerFlowHealthy(true))) return "DEERFLOW";
	if (state.autoGpt.configured) return "AUTOGPT";
	if (state.deerFlow.configured) {
		throw new DeerFlowRequestError({
			code: "DEERFLOW_UNHEALTHY",
			message: "The DeerFlow SuperAgent runtime is temporarily unavailable.",
			status: 503,
			retryable: true,
		});
	}
	throw new DeerFlowConfigError("No autonomous agent runtime is configured.");
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
	const configured = configuredProviderState();
	const [runs, entitlements, deerFlowIsHealthy] = await Promise.all([
		listAgentRuns(session.user.id, limit),
		getEffectiveEntitlements(session.user.id),
		deerFlowHealthy(configured.deerFlow.configured),
	]);
	const deerFlowReady = configured.deerFlow.configured && deerFlowIsHealthy;
	const autoGptReady = configured.autoGpt.configured;
	const preferredProvider: AgentProvider | null = deerFlowReady
		? "DEERFLOW"
		: autoGptReady
			? "AUTOGPT"
			: null;
	return noStoreJson({
		runs,
		feature: {
			enabled: configured.deerFlow.enabled || configured.autoGpt.enabled,
			configured: configured.deerFlow.configured || configured.autoGpt.configured,
			ready: deerFlowReady || autoGptReady,
			preferredProvider,
			providers: {
				DEERFLOW: { ...configured.deerFlow, healthy: deerFlowIsHealthy, ready: deerFlowReady },
				AUTOGPT: { ...configured.autoGpt, healthy: null, ready: autoGptReady },
			},
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
		const provider = await selectProvider(parsed.data.provider);
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

		const submitted = provider === "DEERFLOW"
			? await submitDeerFlowAgentRun({
				userId: session.user.id,
				clientRequestId: parsed.data.clientRequestId,
				objective: parsed.data.objective,
			})
			: await submitAgentRun({
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
				message: `Task accepted by ${submitted.run.provider === "DEERFLOW" ? "DeerFlow 2.0" : "AutoGPT"}.`,
				metadata: { provider: submitted.run.provider },
			}),
			recordAgentRunStepBestEffort({
				runId: submitted.run.id,
				stepKey: "provider-submission",
				type: "PROVIDER_SUBMISSION",
				label: `Submit task to ${submitted.run.provider === "DEERFLOW" ? "DeerFlow 2.0" : "AutoGPT"}`,
				status: "COMPLETED",
			}),
			recordAgentRunStepBestEffort({
				runId: submitted.run.id,
				stepKey: "provider-execution",
				type: "PROVIDER_EXECUTION",
				label: `${submitted.run.provider === "DEERFLOW" ? "DeerFlow 2.0" : "AutoGPT"} execution`,
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
		if (error instanceof DeerFlowConfigError || error instanceof AutoGptConfigError) {
			return noStoreJson(
				{
					error: {
						code: error.code,
						message: "Autonomous agent tasks are not configured for this AIRA deployment.",
					},
				},
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

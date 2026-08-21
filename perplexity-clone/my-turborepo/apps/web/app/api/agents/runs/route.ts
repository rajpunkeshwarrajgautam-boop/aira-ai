import { z } from "zod";

import { auth } from "@/auth";
import { AaeRequestError, checkAaeHealth } from "@/lib/aae/client";
import {
	AaeConfigError,
	getAaeConfig,
	isAaeConfigured,
	isAaeEnabled,
	isAaeUserAllowed,
} from "@/lib/aae/config";
import { submitAaeAgentRun } from "@/lib/aae/runs";
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

type AgentProvider = "DEERFLOW" | "AUTOGPT" | "AAE";

const SubmitRunSchema = z.object({
	clientRequestId: z.string().uuid(),
	objective: z.string().trim().min(3).max(4_000),
	provider: z.enum(["DEERFLOW", "AUTOGPT", "AAE"]).optional(),
});

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	const headers = new Headers(init?.headers);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, { ...init, headers });
}

function configuredProviderState(userId: string) {
	return {
		deerFlow: {
			enabled: isDeerFlowEnabled(),
			configured: isDeerFlowConfigured(),
		},
		autoGpt: {
			enabled: isAutoGptEnabled(),
			configured: isAutoGptConfigured(),
		},
		aae: {
			enabled: isAaeEnabled(),
			configured: isAaeConfigured() && isAaeUserAllowed(userId),
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

async function aaeHealthy(configured: boolean): Promise<boolean> {
	if (!configured) return false;
	try {
		return await checkAaeHealth(getAaeConfig());
	} catch {
		return false;
	}
}

async function selectProvider(userId: string, requested?: AgentProvider): Promise<AgentProvider> {
	const state = configuredProviderState(userId);
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
	if (requested === "AAE") {
		if (!state.aae.configured) {
			throw new AaeConfigError("AAE is not configured for this AIRA user.");
		}
		if (!(await aaeHealthy(true))) {
			throw new AaeRequestError({
				code: "AAE_UNHEALTHY",
				message: "The autonomous engine is temporarily unavailable.",
				status: 503,
				retryable: true,
			});
		}
		return "AAE";
	}

	// Preserve the existing provider order. AAE is a third, opt-in fallback so
	// landing this integration cannot silently change DeerFlow/AutoGPT behavior.
	if (state.deerFlow.configured && (await deerFlowHealthy(true))) return "DEERFLOW";
	if (state.autoGpt.configured) return "AUTOGPT";
	if (state.aae.configured && (await aaeHealthy(true))) return "AAE";
	if (state.deerFlow.configured) {
		throw new DeerFlowRequestError({
			code: "DEERFLOW_UNHEALTHY",
			message: "The DeerFlow SuperAgent runtime is temporarily unavailable.",
			status: 503,
			retryable: true,
		});
	}
	if (state.aae.configured) {
		throw new AaeRequestError({
			code: "AAE_UNHEALTHY",
			message: "The autonomous engine is temporarily unavailable.",
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
	const configured = configuredProviderState(session.user.id);
	const [runs, entitlements, deerFlowIsHealthy, aaeIsHealthy] = await Promise.all([
		listAgentRuns(session.user.id, limit),
		getEffectiveEntitlements(session.user.id),
		deerFlowHealthy(configured.deerFlow.configured),
		aaeHealthy(configured.aae.configured),
	]);
	const deerFlowReady = configured.deerFlow.configured && deerFlowIsHealthy;
	const autoGptReady = configured.autoGpt.configured;
	const aaeReady = configured.aae.configured && aaeIsHealthy;
	const preferredProvider: AgentProvider | null = deerFlowReady
		? "DEERFLOW"
		: autoGptReady
			? "AUTOGPT"
			: aaeReady
				? "AAE"
				: null;
	return noStoreJson({
		runs,
		feature: {
			enabled: configured.deerFlow.enabled || configured.autoGpt.enabled || configured.aae.enabled,
			configured:
				configured.deerFlow.configured || configured.autoGpt.configured || configured.aae.configured,
			ready: deerFlowReady || autoGptReady || aaeReady,
			preferredProvider,
			providers: {
				DEERFLOW: { ...configured.deerFlow, healthy: deerFlowIsHealthy, ready: deerFlowReady },
				AUTOGPT: { ...configured.autoGpt, healthy: null, ready: autoGptReady },
				AAE: { ...configured.aae, healthy: aaeIsHealthy, ready: aaeReady },
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
				{
					error: {
						code: "SAFETY_BLOCKED",
						message: "This autonomous objective cannot be processed by the configured safety policy.",
					},
				},
				{ status: 403 },
			);
		}
		if (error instanceof SafetyGatewayError) {
			return noStoreJson(
				{
					error: {
						code: "SAFETY_GATEWAY_UNAVAILABLE",
						message: "The required safety service is temporarily unavailable.",
					},
				},
				{ status: 503 },
			);
		}
		throw error;
	}

	let leaseId: string | undefined;
	try {
		const provider = await selectProvider(session.user.id, parsed.data.provider);
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
					headers: {
						"Retry-After": String(Math.max(1, Math.ceil((lease.retryAfterMs ?? 1000) / 1000))),
					},
				},
			);
		}
		leaseId = lease.leaseId;

		const submitted =
			provider === "DEERFLOW"
				? await submitDeerFlowAgentRun({
						userId: session.user.id,
						clientRequestId: parsed.data.clientRequestId,
						objective: parsed.data.objective,
					})
				: provider === "AAE"
					? await submitAaeAgentRun({
							userId: session.user.id,
							clientRequestId: parsed.data.clientRequestId,
							objective: parsed.data.objective,
						})
					: await submitAgentRun({
							userId: session.user.id,
							clientRequestId: parsed.data.clientRequestId,
							objective: parsed.data.objective,
						});
		return noStoreJson(submitted, { status: 202 });
	} catch (error) {
		if (error instanceof PlanEnforcementError) {
			return noStoreJson(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		if (
			error instanceof DeerFlowConfigError ||
			error instanceof AutoGptConfigError ||
			error instanceof AaeConfigError
		) {
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
		if (
			error instanceof DeerFlowRequestError ||
			error instanceof AutoGptRequestError ||
			error instanceof AaeRequestError
		) {
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

import { z } from "zod";

import { auth } from "@/auth";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubmitRunSchema = z.object({
	clientRequestId: z.string().uuid(),
	objective: z.string().trim().min(3).max(4_000),
});

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
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
	const [runs, entitlements] = await Promise.all([
		listAgentRuns(session.user.id, limit),
		getEffectiveEntitlements(session.user.id),
	]);
	return noStoreJson({
		runs,
		feature: {
			enabled: isAutoGptEnabled(),
			configured: isAutoGptConfigured(),
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
		const submitted = await submitAgentRun({
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
		if (error instanceof AutoGptConfigError) {
			return noStoreJson(
				{
					error: {
						code: error.code,
						message: "Agent tasks are not configured for this Aira deployment.",
					},
				},
				{ status: 503 },
			);
		}
		if (error instanceof AutoGptRequestError) {
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
	}
}

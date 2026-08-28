import { z } from "zod";

import { auth } from "@/auth";
import { startManagedRun } from "@/lib/agent-platform/orchestrator";
import { getProjectForUser, listProjectRuns } from "@/lib/agent-platform/store";
import type { AgentRuntimeId } from "@/lib/agent-runtime/types";
import { AgentRuntimeError } from "@/lib/agent-runtime/types";
import { PlanEnforcementError } from "@/lib/billing/plan-enforcement";
import {
	assertSafetyAllowed,
	SafetyBlockedError,
	SafetyGatewayError,
} from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const StartRunSchema = z.object({
	objective: z.string().trim().min(3).max(8_000).optional(),
	provider: z.enum(["DEERFLOW", "AUTOGPT", "AGENT_SWARM"]).optional(),
	budgets: z
		.object({
			maxAgents: z.number().int().min(13).max(24).optional(),
			maxParallelAgents: z.number().int().min(1).max(6).optional(),
			maxToolCalls: z.number().int().min(10).max(500).optional(),
			maxTokens: z.number().int().min(10_000).max(2_000_000).optional(),
			maxCostUsd: z.number().min(0).max(250).optional(),
			maxDurationMinutes: z.number().int().min(10).max(1_440).optional(),
			maxRetries: z.number().int().min(0).max(5).optional(),
		})
		.optional(),
});

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { projectId } = await params;
	const project = await getProjectForUser(session.user.id, projectId);
	if (!project) {
		return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
	}
	return json({ project, runs: await listProjectRuns(session.user.id, project.id) });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { projectId } = await params;
	const project = await getProjectForUser(session.user.id, projectId);
	if (!project) {
		return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
	}
	const body = await req.json().catch(() => ({}));
	const parsed = StartRunSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: "The managed-run configuration is invalid.",
					details: z.treeifyError(parsed.error),
				},
			},
			{ status: 400 },
		);
	}
	const objective = parsed.data.objective?.trim() || project.objective;
	try {
		await assertSafetyAllowed("agent-objective", objective);
		const result = await startManagedRun({
			userId: session.user.id,
			projectId: project.id,
			objective,
			requestedRuntime: parsed.data.provider as AgentRuntimeId | undefined,
			budgets: parsed.data.budgets,
		});
		return json(result, { status: 202 });
	} catch (error) {
		if (error instanceof SafetyBlockedError) {
			return json(
				{ error: { code: "SAFETY_BLOCKED", message: "This autonomous objective cannot be processed by the configured safety policy." } },
				{ status: 403 },
			);
		}
		if (error instanceof SafetyGatewayError) {
			return json(
				{ error: { code: "SAFETY_GATEWAY_UNAVAILABLE", message: "The required safety service is temporarily unavailable." } },
				{ status: 503 },
			);
		}
		if (error instanceof PlanEnforcementError) {
			return json({ error: { code: error.code, message: error.message } }, { status: error.status });
		}
		if (error instanceof AgentRuntimeError) {
			return json(
				{ error: { code: error.code, message: error.message, retryable: error.retryable } },
				{ status: error.status },
			);
		}
		console.error("[agent-platform:project-run:create]", error);
		return json(
			{ error: { code: "MANAGED_RUN_FAILED", message: "AIRA could not start the managed mission." } },
			{ status: 500 },
		);
	}
}

import { AgentRunStatus } from "@/generated/prisma/enums";
import { refreshDeerFlowAgentRun } from "@/lib/deerflow/runs";
import { refreshAgentRun } from "@/lib/autogpt/runs";
import { prisma } from "@/lib/prisma";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 25;
const DEFAULT_MIN_AGE_MS = 5_000;
const MAX_MIN_AGE_MS = 5 * 60_000;
const ACTIVE_STATUSES = [
	AgentRunStatus.QUEUED,
	AgentRunStatus.RUNNING,
	AgentRunStatus.REVIEW,
] as const;

type ReconcileOutcome = "refreshed" | "skipped" | "failed";

export interface AgentRunReconcileSummary {
	readonly scanned: number;
	readonly refreshed: number;
	readonly skipped: number;
	readonly failed: number;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function getAgentRunReconcilerConfig(): {
	readonly batchSize: number;
	readonly minAgeMs: number;
} {
	return {
		batchSize: boundedInteger(
			process.env.AIRA_AGENT_RECONCILE_BATCH_SIZE,
			DEFAULT_BATCH_SIZE,
			1,
			MAX_BATCH_SIZE,
		),
		minAgeMs: boundedInteger(
			process.env.AIRA_AGENT_RECONCILE_MIN_AGE_MS,
			DEFAULT_MIN_AGE_MS,
			1_000,
			MAX_MIN_AGE_MS,
		),
	};
}

async function reconcileOne(run: {
	readonly id: string;
	readonly userId: string;
	readonly provider: string;
}): Promise<ReconcileOutcome> {
	try {
		if (run.provider === "DEERFLOW") {
			await refreshDeerFlowAgentRun(run.userId, run.id);
			return "refreshed";
		}
		if (run.provider === "AUTOGPT") {
			await refreshAgentRun(run.userId, run.id);
			return "refreshed";
		}
		console.warn("[agents:reconcile:unsupported-provider]", {
			runId: run.id,
			provider: run.provider,
		});
		return "skipped";
	} catch (error) {
		console.error("[agents:reconcile:run]", {
			runId: run.id,
			provider: run.provider,
			error: error instanceof Error ? error.message : "unknown reconciliation failure",
		});
		return "failed";
	}
}

/**
 * Bounded provider-neutral reconciliation pass for accepted/pending autonomous runs.
 *
 * This function never submits a new provider execution. It only calls the existing
 * refresh paths, which reconcile the stored or checkpoint-recovered remote handle.
 * A persistent external worker can invoke the protected endpoint repeatedly without
 * requiring a user to keep the Run Center open.
 */
export async function reconcileActiveAgentRuns(): Promise<AgentRunReconcileSummary> {
	const config = getAgentRunReconcilerConfig();
	const cutoff = new Date(Date.now() - config.minAgeMs);
	const runs = await prisma.agentRun.findMany({
		where: {
			status: { in: [...ACTIVE_STATUSES] },
			updatedAt: { lte: cutoff },
		},
		orderBy: { updatedAt: "asc" },
		take: config.batchSize,
		select: { id: true, userId: true, provider: true },
	});

	const outcomes = await Promise.all(runs.map(reconcileOne));
	return {
		scanned: runs.length,
		refreshed: outcomes.filter((outcome) => outcome === "refreshed").length,
		skipped: outcomes.filter((outcome) => outcome === "skipped").length,
		failed: outcomes.filter((outcome) => outcome === "failed").length,
	};
}

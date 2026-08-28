import { prisma } from "@/lib/prisma";

import { tickManagedRun } from "./orchestrator";

export interface ScheduledRunRef {
	readonly id: string;
	readonly userId: string;
}

export interface SchedulerResult {
	readonly attempted: number;
	readonly advanced: number;
	readonly failures: readonly { runId: string; code: string }[];
}

export async function listSchedulableRuns(limit = 8): Promise<ScheduledRunRef[]> {
	const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
	return prisma.$queryRaw<ScheduledRunRef[]>`
		select "id", "userId"
		from "AgentPlatformRun"
		where "status" in ('PLANNING','RUNNING','WAITING','BLOCKED','APPROVAL_REQUIRED')
		order by "updatedAt" asc
		limit ${safeLimit}
	`;
}

export async function advanceScheduledRuns(limit = 8): Promise<SchedulerResult> {
	const runs = await listSchedulableRuns(limit);
	let advanced = 0;
	const failures: Array<{ runId: string; code: string }> = [];

	for (const run of runs) {
		try {
			await tickManagedRun(run.userId, run.id);
			advanced += 1;
		} catch (error) {
			failures.push({
				runId: run.id,
				code: error instanceof Error ? error.name || "ERROR" : "UNKNOWN_ERROR",
			});
		}
	}
	return { attempted: runs.length, advanced, failures };
}

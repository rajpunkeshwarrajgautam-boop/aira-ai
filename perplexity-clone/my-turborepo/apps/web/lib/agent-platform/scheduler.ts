import { prisma } from "@/lib/prisma";

import { tickManagedRun } from "./orchestrator";

export interface ScheduledRunRef {
	readonly id: string;
	readonly userId: string;
	readonly leaseOwner: string;
}

export interface SchedulerResult {
	readonly workerId: string;
	readonly attempted: number;
	readonly advanced: number;
	readonly failures: readonly { runId: string; code: string }[];
}

const DEFAULT_LEASE_SECONDS = 45;

/**
 * Atomically leases schedulable missions. FOR UPDATE SKIP LOCKED makes
 * overlapping scheduler processes safe: a mission can be owned by only one
 * scheduler tick at a time, while other workers continue with different runs.
 *
 * APPROVAL_REQUIRED and BLOCKED missions intentionally do not busy-loop. Their
 * user/action routes move them back to an executable state when the blocker is
 * resolved.
 */
export async function claimSchedulableRuns(
	workerId: string,
	limit = 8,
	leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<ScheduledRunRef[]> {
	const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
	const safeLease = Math.max(15, Math.min(180, Math.trunc(leaseSeconds)));
	return prisma.$queryRaw<ScheduledRunRef[]>`
		with candidates as (
			select "id"
			from "AgentPlatformRun"
			where "status" in ('PLANNING','RUNNING','WAITING')
			  and ("nextSchedulerAttemptAt" is null or "nextSchedulerAttemptAt" <= current_timestamp)
			  and ("schedulerLeaseExpiresAt" is null or "schedulerLeaseExpiresAt" < current_timestamp)
			order by "updatedAt" asc
			for update skip locked
			limit ${safeLimit}
		)
		update "AgentPlatformRun" r
		set "schedulerLeaseOwner"=${workerId},
			"schedulerLeaseExpiresAt"=current_timestamp + (${safeLease} * interval '1 second'),
			"updatedAt"=current_timestamp
		from candidates c
		where r."id"=c."id"
		returning r."id", r."userId", r."schedulerLeaseOwner" as "leaseOwner"
	`;
}

/**
 * Extends only a still-live lease owned by this exact scheduler. Once a lease
 * expires it is fenced: the old owner must not resurrect it after another
 * scheduler has become eligible to claim the mission.
 */
export async function renewSchedulerLease(
	runId: string,
	workerId: string,
	leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<boolean> {
	const safeLease = Math.max(15, Math.min(180, Math.trunc(leaseSeconds)));
	const changed = await prisma.$executeRaw`
		update "AgentPlatformRun"
		set "schedulerLeaseExpiresAt"=current_timestamp + (${safeLease} * interval '1 second'),
			"updatedAt"=current_timestamp
		where "id"=${runId}
		  and "schedulerLeaseOwner"=${workerId}
		  and "schedulerLeaseExpiresAt" >= current_timestamp
		  and "status" in ('PLANNING','RUNNING','WAITING')
	`;
	return changed === 1;
}

function startSchedulerLeaseHeartbeat(
	runId: string,
	workerId: string,
	leaseSeconds = DEFAULT_LEASE_SECONDS,
): { stop(): Promise<boolean> } {
	const intervalMs = Math.max(5_000, Math.floor((leaseSeconds * 1_000) / 3));
	let stopped = false;
	let leaseHealthy = true;
	let inFlight: Promise<void> | null = null;

	const renew = async () => {
		try {
			if (!(await renewSchedulerLease(runId, workerId, leaseSeconds))) leaseHealthy = false;
		} catch {
			leaseHealthy = false;
		}
	};
	const timer = setInterval(() => {
		if (stopped || inFlight) return;
		inFlight = renew().finally(() => {
			inFlight = null;
		});
	}, intervalMs);
	timer.unref?.();

	return {
		async stop() {
			stopped = true;
			clearInterval(timer);
			if (inFlight) await inFlight;
			return leaseHealthy;
		},
	};
}

async function releaseSchedulerLease(
	runId: string,
	workerId: string,
	outcome: "SUCCESS" | "FAILURE",
): Promise<void> {
	if (outcome === "SUCCESS") {
		await prisma.$executeRaw`
			update "AgentPlatformRun"
			set "schedulerLeaseOwner"=null,
				"schedulerLeaseExpiresAt"=null,
				"schedulerFailureCount"=0,
				"nextSchedulerAttemptAt"=case
					when "status" in ('PLANNING','RUNNING','WAITING') then current_timestamp + interval '2 seconds'
					else null
				end,
				"updatedAt"=current_timestamp
			where "id"=${runId} and "schedulerLeaseOwner"=${workerId}
		`;
		return;
	}
	await prisma.$executeRaw`
		update "AgentPlatformRun"
		set "schedulerLeaseOwner"=null,
			"schedulerLeaseExpiresAt"=null,
			"schedulerFailureCount"="schedulerFailureCount"+1,
			"nextSchedulerAttemptAt"=current_timestamp +
				(least(300, greatest(5, ("schedulerFailureCount"+1) * 15)) * interval '1 second'),
			"updatedAt"=current_timestamp
		where "id"=${runId} and "schedulerLeaseOwner"=${workerId}
	`;
}

export async function advanceScheduledRuns(limit = 8): Promise<SchedulerResult> {
	const workerId = `scheduler:${crypto.randomUUID()}`;
	const runs = await claimSchedulableRuns(workerId, limit);
	let advanced = 0;
	const failures: Array<{ runId: string; code: string }> = [];

	for (const run of runs) {
		const heartbeat = startSchedulerLeaseHeartbeat(run.id, workerId);
		try {
			await tickManagedRun(run.userId, run.id);
			const leaseHealthy = await heartbeat.stop();
			if (!leaseHealthy) {
				failures.push({ runId: run.id, code: "SCHEDULER_LEASE_LOST" });
				await releaseSchedulerLease(run.id, workerId, "FAILURE").catch(() => undefined);
				continue;
			}
			advanced += 1;
			await releaseSchedulerLease(run.id, workerId, "SUCCESS");
		} catch (error) {
			await heartbeat.stop();
			failures.push({
				runId: run.id,
				code: error instanceof Error ? error.name || "ERROR" : "UNKNOWN_ERROR",
			});
			await releaseSchedulerLease(run.id, workerId, "FAILURE").catch(() => undefined);
		}
	}
	return { workerId, attempted: runs.length, advanced, failures };
}

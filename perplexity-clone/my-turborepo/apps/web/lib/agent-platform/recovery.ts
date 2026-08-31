import { AgentRunStatus } from "@/generated/prisma/enums";
import { getAgentRuntime } from "@/lib/agent-runtime/registry";
import { prisma } from "@/lib/prisma";

import { tickManagedRun } from "./orchestrator";
import { appendEvent, getRunForUser, listTasks } from "./store";
import type { PlatformRunStatus, PlatformTaskStatus } from "./types";

export type ManagedTaskRecoveryOutcome = "PENDING" | "NOOP" | "RECONCILED";

export interface ManagedTaskRecoveryResult {
	readonly outcome: ManagedTaskRecoveryOutcome;
	readonly reason: string;
	readonly runtimeRunId: string | null;
	readonly runtimeStatus: AgentRunStatus | null;
	readonly runStatus: PlatformRunStatus;
	readonly taskStatus: PlatformTaskStatus;
}

export class ManagedTaskRecoveryError extends Error {
	readonly code: "NOT_FOUND" | "RUN_TERMINAL" | "RUN_NOT_RECOVERABLE";
	readonly status: number;

	constructor(code: ManagedTaskRecoveryError["code"], message: string, status: number) {
		super(message);
		this.name = "ManagedTaskRecoveryError";
		this.code = code;
		this.status = status;
	}
}

async function currentResult(input: {
	readonly userId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly outcome: ManagedTaskRecoveryOutcome;
	readonly reason: string;
	readonly runtimeStatus?: AgentRunStatus | null;
}): Promise<ManagedTaskRecoveryResult> {
	const run = await getRunForUser(input.userId, input.runId);
	if (!run) throw new ManagedTaskRecoveryError("NOT_FOUND", "Managed run not found.", 404);
	const task = (await listTasks(run.id)).find((entry) => entry.id === input.taskId);
	if (!task) throw new ManagedTaskRecoveryError("NOT_FOUND", "Managed task not found.", 404);
	return {
		outcome: input.outcome,
		reason: input.reason,
		runtimeRunId: task.runtimeRunId,
		runtimeStatus: input.runtimeStatus ?? null,
		runStatus: run.status,
		taskStatus: task.status,
	};
}

/**
 * Reconcile one blocked delegated task without ever creating a replacement
 * runtime execution. The same persisted AgentRun is refreshed first. Only an
 * authoritative provider state may reactivate the existing task; REVIEW,
 * missing linkage, provider errors and identity mismatches stay fail-closed.
 */
export async function reconcileBlockedManagedTask(input: {
	readonly userId: string;
	readonly runId: string;
	readonly taskId: string;
}): Promise<ManagedTaskRecoveryResult> {
	const run = await getRunForUser(input.userId, input.runId);
	if (!run) throw new ManagedTaskRecoveryError("NOT_FOUND", "Managed run not found.", 404);
	if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
		throw new ManagedTaskRecoveryError("RUN_TERMINAL", "A terminal managed run cannot be reconciled.", 409);
	}
	if (run.status !== "BLOCKED" && run.status !== "RUNNING") {
		throw new ManagedTaskRecoveryError(
			"RUN_NOT_RECOVERABLE",
			`Managed run state ${run.status} cannot reconcile blocked runtime work.`,
			409,
		);
	}

	const task = (await listTasks(run.id)).find((entry) => entry.id === input.taskId);
	if (!task) throw new ManagedTaskRecoveryError("NOT_FOUND", "Managed task not found.", 404);
	if (task.status !== "BLOCKED") {
		return currentResult({
			...input,
			outcome: "NOOP",
			reason: "task_not_blocked",
		});
	}
	if (!task.runtimeRunId) {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_link_missing",
		});
	}

	const local = await prisma.agentRun.findFirst({
		where: { id: task.runtimeRunId, userId: input.userId },
		select: { id: true, provider: true },
	});
	if (!local) {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_run_missing",
		});
	}

	const runtime = getAgentRuntime(local.provider);
	let child: Awaited<ReturnType<typeof runtime.refreshRun>>;
	try {
		child = await runtime.refreshRun(input.userId, local.id);
	} catch {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_refresh_failed",
		});
	}
	if (!child) {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_refresh_missing",
		});
	}
	if (child.id !== task.runtimeRunId) {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_identity_mismatch",
			runtimeStatus: child.status,
		});
	}
	if (child.status === AgentRunStatus.REVIEW) {
		return currentResult({
			...input,
			outcome: "PENDING",
			reason: "runtime_review_pending",
			runtimeStatus: child.status,
		});
	}

	const transitioned = await prisma.$transaction(async (tx) => {
		const parent = await tx.$queryRaw<Array<{ status: PlatformRunStatus }>>`
			select "status"
			from "AgentPlatformRun"
			where "id"=${run.id} and "userId"=${input.userId} and "projectId"=${run.projectId}
			for update
		`;
		const parentStatus = parent[0]?.status;
		if (parentStatus !== "BLOCKED" && parentStatus !== "RUNNING") return false;

		const taskChanged = await tx.$executeRaw`
			update "AgentTask"
			set "status"='RUNNING', "lastError"=null, "updatedAt"=current_timestamp
			where "id"=${task.id}
			  and "runId"=${run.id}
			  and "projectId"=${run.projectId}
			  and "status"='BLOCKED'
			  and "runtimeRunId"=${task.runtimeRunId}
			  and "attempt"=${task.attempt}
		`;
		if (taskChanged !== 1) return false;

		await tx.$executeRaw`
			update "AgentInstance"
			set "status"='WORKING', "updatedAt"=current_timestamp
			where "runId"=${run.id} and "currentTaskId"=${task.id} and "status"='WAITING'
		`;
		if (parentStatus === "BLOCKED") {
			await tx.$executeRaw`
				update "AgentPlatformRun"
				set "status"='RUNNING', "updatedAt"=current_timestamp
				where "id"=${run.id} and "status"='BLOCKED'
			`;
		}
		return true;
	});

	if (!transitioned) {
		return currentResult({
			...input,
			outcome: "NOOP",
			reason: "recovery_state_changed",
			runtimeStatus: child.status,
		});
	}

	await appendEvent({
		projectId: run.projectId,
		runId: run.id,
		taskId: task.id,
		type: "task.reconciled",
		payload: {
			reason: "existing_runtime_execution_reconciled",
			runtimeRunId: child.id,
			runtimeStatus: child.status,
			attempt: task.attempt,
		},
	});

	// Re-enter the canonical reconciler with the same task/runtime identity. It
	// owns COMPLETED/FAILED/TERMINATED transitions and bounded retry semantics.
	await tickManagedRun(input.userId, run.id);
	return currentResult({
		...input,
		outcome: "RECONCILED",
		reason: "existing_runtime_execution_reconciled",
		runtimeStatus: child.status,
	});
}

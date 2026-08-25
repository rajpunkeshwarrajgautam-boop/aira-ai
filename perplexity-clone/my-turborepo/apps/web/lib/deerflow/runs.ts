import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import {
	recordRemoteAcceptedCheckpoint,
	recoverRemoteExecutionIdFromCheckpoint,
} from "@/lib/agents/run-checkpoints";
import { classifyStaleRun } from "@/lib/agents/run-reconciliation";
import type { AgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";

import {
	cancelDeerFlowRun,
	createDeerFlowRun,
	createDeerFlowThread,
	DeerFlowRequestError,
	extractDeerFlowResult,
	getDeerFlowRun,
	getDeerFlowThreadState,
} from "./client";
import { getDeerFlowConfig } from "./config";

const ACTIVE_SYNC_INTERVAL_MS = 2_500;
const PROVIDER = "DEERFLOW";
const GRAPH_ID = "deerflow:lead-agent";
const GRAPH_VERSION = 2;

const RUN_SELECT = {
	id: true,
	provider: true,
	objective: true,
	status: true,
	result: true,
	errorMessage: true,
	createdAt: true,
	updatedAt: true,
	completedAt: true,
} satisfies Prisma.AgentRunSelect;

type SelectedRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

function toDto(run: SelectedRun): AgentRunDto {
	return {
		id: run.id,
		provider: run.provider,
		objective: run.objective,
		status: run.status,
		result: run.result,
		errorMessage: run.errorMessage,
		createdAt: run.createdAt.toISOString(),
		updatedAt: run.updatedAt.toISOString(),
		completedAt: run.completedAt?.toISOString() ?? null,
	};
}

function statusFromDeerFlow(status: string): AgentRunStatus {
	switch (status.toLowerCase()) {
		case "pending":
			return AgentRunStatus.QUEUED;
		case "running":
			return AgentRunStatus.RUNNING;
		case "success":
			return AgentRunStatus.COMPLETED;
		case "interrupted":
			return AgentRunStatus.TERMINATED;
		case "error":
		case "timeout":
		default:
			return AgentRunStatus.FAILED;
	}
}

function isTerminal(status: AgentRunStatus): boolean {
	return (
		status === AgentRunStatus.COMPLETED ||
		status === AgentRunStatus.FAILED ||
		status === AgentRunStatus.TERMINATED
	);
}

function encodeRemoteExecution(threadId: string, runId: string): string {
	return `${threadId}|${runId}`;
}

function decodeRemoteExecution(value: string): { readonly threadId: string; readonly runId: string } {
	const separator = value.indexOf("|");
	if (separator <= 0 || separator >= value.length - 1) {
		throw new DeerFlowRequestError({
			code: "DEERFLOW_REMOTE_ID_INVALID",
			message: "The stored DeerFlow execution identifier is invalid.",
			status: 500,
		});
	}
	return { threadId: value.slice(0, separator), runId: value.slice(separator + 1) };
}

export async function submitDeerFlowAgentRun(options: {
	readonly userId: string;
	readonly clientRequestId: string;
	readonly objective: string;
}): Promise<{ readonly run: AgentRunDto; readonly agentRunsRemaining: number }> {
	const config = getDeerFlowConfig();
	const existing = await prisma.agentRun.findUnique({
		where: {
			userId_clientRequestId: {
				userId: options.userId,
				clientRequestId: options.clientRequestId,
			},
		},
		select: RUN_SELECT,
	});
	if (existing) {
		const entitlements = await getEffectiveEntitlements(options.userId);
		return { run: toDto(existing), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let pendingRun: SelectedRun;
	try {
		pendingRun = await prisma.agentRun.create({
			data: {
				userId: options.userId,
				clientRequestId: options.clientRequestId,
				provider: PROVIDER,
				graphId: GRAPH_ID,
				graphVersion: GRAPH_VERSION,
				objective: options.objective,
			},
			select: RUN_SELECT,
		});
	} catch (error) {
		const concurrent = await prisma.agentRun.findUnique({
			where: {
				userId_clientRequestId: {
					userId: options.userId,
					clientRequestId: options.clientRequestId,
				},
			},
			select: RUN_SELECT,
		});
		if (!concurrent) throw error;
		const entitlements = await getEffectiveEntitlements(options.userId);
		return { run: toDto(concurrent), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let remaining: number;
	try {
		const entitlements = await consumeAgentRunQuota(options.userId);
		remaining = entitlements.agentRunsRemaining;
	} catch (error) {
		await prisma.agentRun.delete({ where: { id: pendingRun.id } }).catch(() => undefined);
		throw error;
	}

	const threadId = `aira_${pendingRun.id}`;
	let remoteRun: Awaited<ReturnType<typeof createDeerFlowRun>>;
	try {
		await createDeerFlowThread(config, options.userId, threadId, pendingRun.id);
		remoteRun = await createDeerFlowRun(
			config,
			options.userId,
			threadId,
			options.objective,
			pendingRun.id,
		);
	} catch (error) {
		const outcomeUnknown =
			error instanceof DeerFlowRequestError && error.submissionOutcomeUnknown;
		await Promise.allSettled([
			prisma.agentRun.update({
				where: { id: pendingRun.id },
				data: {
					status: AgentRunStatus.FAILED,
					errorMessage: outcomeUnknown
						? "DeerFlow did not confirm whether it accepted this task. AIRA did not retry it to avoid duplicate autonomous work."
						: "DeerFlow could not accept this task.",
					completedAt: new Date(),
				},
			}),
			...(outcomeUnknown ? [] : [refundAgentRunQuota(options.userId)]),
		]);
		throw error;
	}

	const remoteExecutionId = encodeRemoteExecution(remoteRun.thread_id, remoteRun.run_id);
	const remoteStatus = statusFromDeerFlow(remoteRun.status);
	let checkpointSaved = false;
	try {
		await recordRemoteAcceptedCheckpoint({
			runId: pendingRun.id,
			provider: PROVIDER,
			remoteExecutionId,
			status: remoteStatus,
		});
		checkpointSaved = true;
	} catch (error) {
		console.error("[agents:deerflow:checkpoint]", {
			runId: pendingRun.id,
			error: error instanceof Error ? error.message : "checkpoint persistence failed",
		});
	}

	const persistRemoteId = () =>
		prisma.agentRun.update({
			where: { id: pendingRun.id },
			data: { remoteExecutionId, status: remoteStatus },
			select: RUN_SELECT,
		});
	let submitted: SelectedRun;
	try {
		submitted = await persistRemoteId();
	} catch {
		if (!checkpointSaved) {
			try {
				await recordRemoteAcceptedCheckpoint({
					runId: pendingRun.id,
					provider: PROVIDER,
					remoteExecutionId,
					status: remoteStatus,
				});
				checkpointSaved = true;
			} catch {
				// The local row retry below remains safe and never resubmits remote work.
			}
		}
		// A local persistence retry is idempotent. Do not mark a confirmed remote
		// run failed or refund quota merely because this database write was interrupted.
		submitted = await persistRemoteId();
	}
	return { run: toDto(submitted), agentRunsRemaining: remaining };
}

/** Moves a run that outlived its reconciliation bound into a terminal state. */
async function closeStaleRun(runId: string, errorMessage: string): Promise<SelectedRun> {
	return prisma.agentRun.update({
		where: { id: runId },
		data: {
			status: AgentRunStatus.FAILED,
			errorMessage,
			completedAt: new Date(),
		},
		select: RUN_SELECT,
	});
}

export async function refreshDeerFlowAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({
		where: { id: runId, userId, provider: PROVIDER },
	});
	if (!row) return null;
	if (isTerminal(row.status)) return toDto(row);

	const remoteExecutionId =
		row.remoteExecutionId ??
		(await recoverRemoteExecutionIdFromCheckpoint({
			userId,
			runId: row.id,
			provider: PROVIDER,
		}));
	const stale = classifyStaleRun({
		remoteExecutionId,
		createdAt: row.createdAt,
	});
	if (stale) return toDto(await closeStaleRun(row.id, stale.errorMessage));

	if (!remoteExecutionId) return toDto(row);
	if (row.remoteExecutionId && Date.now() - row.updatedAt.getTime() < ACTIVE_SYNC_INTERVAL_MS) return toDto(row);

	const { threadId, runId: remoteRunId } = decodeRemoteExecution(remoteExecutionId);
	const config = getDeerFlowConfig();
	let remote: Awaited<ReturnType<typeof getDeerFlowRun>>;
	try {
		remote = await getDeerFlowRun(config, userId, threadId, remoteRunId);
	} catch (error) {
		// A 404 is durable: DeerFlow no longer knows this run, so polling it again
		// can only keep the workspace spinning. Every other failure is transient and
		// must surface as a sync warning against the cached row instead.
		if (error instanceof DeerFlowRequestError && error.status === 404) {
			return toDto(
				await closeStaleRun(
					row.id,
					"The agent runtime no longer has a record of this task, so AIRA closed it.",
				),
			);
		}
		throw error;
	}
	const status = statusFromDeerFlow(remote.status);
	const terminal = isTerminal(status);
	let result: Prisma.InputJsonValue | undefined;
	if (status === AgentRunStatus.COMPLETED) {
		const state = await getDeerFlowThreadState(config, userId, threadId);
		result = extractDeerFlowResult(state, remote) as unknown as Prisma.InputJsonValue;
	}

	const errorMessage =
		status === AgentRunStatus.FAILED
			? remote.stop_reason
				? `DeerFlow stopped: ${remote.stop_reason}`
				: "DeerFlow reported that this task failed."
			: null;
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			...(result !== undefined ? { result } : {}),
			...(errorMessage ? { errorMessage } : {}),
			completedAt: terminal ? row.completedAt ?? new Date() : null,
		},
		select: RUN_SELECT,
	});
	return toDto(updated);
}

export async function cancelDeerFlowAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({
		where: { id: runId, userId, provider: PROVIDER },
	});
	if (!row) return null;
	if (isTerminal(row.status)) return toDto(row);

	const remoteExecutionId =
		row.remoteExecutionId ??
		(await recoverRemoteExecutionIdFromCheckpoint({
			userId,
			runId: row.id,
			provider: PROVIDER,
		}));
	if (!remoteExecutionId) return toDto(row);

	const { threadId, runId: remoteRunId } = decodeRemoteExecution(remoteExecutionId);
	const config = getDeerFlowConfig();
	await cancelDeerFlowRun(config, userId, threadId, remoteRunId);

	// Cancellation is asynchronous in DeerFlow. Read back once for an accurate
	// status; if it is still running, the normal AIRA polling loop will observe
	// the eventual `interrupted` state rather than claiming success early.
	const remote = await getDeerFlowRun(config, userId, threadId, remoteRunId);
	const status = statusFromDeerFlow(remote.status);
	const terminal = isTerminal(status);
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			completedAt: terminal ? row.completedAt ?? new Date() : null,
		},
		select: RUN_SELECT,
	});
	return toDto(updated);
}

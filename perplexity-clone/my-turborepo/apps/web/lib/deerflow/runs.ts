import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import type { AgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";

import {
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
	try {
		await createDeerFlowThread(config, options.userId, threadId, pendingRun.id);
		const remoteRun = await createDeerFlowRun(
			config,
			options.userId,
			threadId,
			options.objective,
			pendingRun.id,
		);
		const remoteExecutionId = encodeRemoteExecution(remoteRun.thread_id, remoteRun.run_id);
		const submitted = await prisma.agentRun.update({
			where: { id: pendingRun.id },
			data: {
				remoteExecutionId,
				status: statusFromDeerFlow(remoteRun.status),
			},
			select: RUN_SELECT,
		});
		return { run: toDto(submitted), agentRunsRemaining: remaining };
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
}

export async function refreshDeerFlowAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({
		where: { id: runId, userId, provider: PROVIDER },
	});
	if (!row) return null;
	if (isTerminal(row.status) || !row.remoteExecutionId) return toDto(row);
	if (Date.now() - row.updatedAt.getTime() < ACTIVE_SYNC_INTERVAL_MS) return toDto(row);

	const { threadId, runId: remoteRunId } = decodeRemoteExecution(row.remoteExecutionId);
	const config = getDeerFlowConfig();
	const remote = await getDeerFlowRun(config, userId, threadId, remoteRunId);
	const status = statusFromDeerFlow(remote.status);
	const terminal = isTerminal(status);
	let result: Prisma.InputJsonValue | undefined;
	if (status === AgentRunStatus.COMPLETED) {
		const state = await getDeerFlowThreadState(config, userId, threadId);
		result = extractDeerFlowResult(state, remote) as Prisma.InputJsonValue;
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

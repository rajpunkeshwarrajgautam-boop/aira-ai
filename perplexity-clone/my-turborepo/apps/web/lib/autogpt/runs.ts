import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { classifyStaleRun } from "@/lib/agents/run-reconciliation";
import { prisma } from "@/lib/prisma";

import {
	AutoGptRequestError,
	executeAutoGptGraph,
	getAutoGptExecution,
	safeStoredOutput,
} from "./client";
import { getAutoGptConfig } from "./config";

const ACTIVE_SYNC_INTERVAL_MS = 2_500;

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

export interface AgentRunDto {
	readonly id: string;
	readonly provider: string;
	readonly objective: string;
	readonly status: AgentRunStatus;
	readonly result: unknown | null;
	readonly errorMessage: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly completedAt: string | null;
}

export function toAgentRunDto(run: SelectedRun): AgentRunDto {
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

function statusFromProvider(status: string): AgentRunStatus {
	switch (status.toUpperCase()) {
		case "QUEUED":
			return AgentRunStatus.QUEUED;
		case "COMPLETED":
			return AgentRunStatus.COMPLETED;
		case "FAILED":
			return AgentRunStatus.FAILED;
		case "TERMINATED":
			return AgentRunStatus.TERMINATED;
		case "REVIEW":
			return AgentRunStatus.REVIEW;
		case "INCOMPLETE":
		case "RUNNING":
		default:
			return AgentRunStatus.RUNNING;
	}
}

function isTerminal(status: AgentRunStatus): boolean {
	return (
		status === AgentRunStatus.COMPLETED ||
		status === AgentRunStatus.FAILED ||
		status === AgentRunStatus.TERMINATED
	);
}

export async function listAgentRuns(userId: string, limit: number): Promise<AgentRunDto[]> {
	const rows = await prisma.agentRun.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: Math.min(50, Math.max(1, limit)),
		select: RUN_SELECT,
	});
	return rows.map(toAgentRunDto);
}

export async function getAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({
		where: { id: runId, userId },
		select: RUN_SELECT,
	});
	return row ? toAgentRunDto(row) : null;
}

export async function submitAgentRun(options: {
	readonly userId: string;
	readonly clientRequestId: string;
	readonly objective: string;
	readonly billingMode?: "BILLABLE" | "DELEGATED";
}): Promise<{ readonly run: AgentRunDto; readonly agentRunsRemaining: number }> {
	const config = getAutoGptConfig();
	const billable = options.billingMode !== "DELEGATED";
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
		return {
			run: toAgentRunDto(existing),
			agentRunsRemaining: entitlements.agentRunsRemaining,
		};
	}

	let pendingRun: SelectedRun;
	try {
		pendingRun = await prisma.agentRun.create({
			data: {
				userId: options.userId,
				clientRequestId: options.clientRequestId,
				provider: "AUTOGPT",
				graphId: config.graphId,
				graphVersion: config.graphVersion,
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
		return {
			run: toAgentRunDto(concurrent),
			agentRunsRemaining: entitlements.agentRunsRemaining,
		};
	}

	let remaining: number;
	try {
		const entitlements = billable
			? await consumeAgentRunQuota(options.userId)
			: await getEffectiveEntitlements(options.userId);
		remaining = entitlements.agentRunsRemaining;
	} catch (error) {
		await prisma.agentRun.delete({ where: { id: pendingRun.id } }).catch(() => undefined);
		throw error;
	}

	let remoteExecutionId: string;
	try {
		remoteExecutionId = await executeAutoGptGraph(
			config,
			options.objective,
			pendingRun.id,
		);
	} catch (error) {
		const outcomeUnknown =
			error instanceof AutoGptRequestError && error.submissionOutcomeUnknown;
		await Promise.allSettled([
			prisma.agentRun.update({
				where: { id: pendingRun.id },
				data: {
					status: AgentRunStatus.FAILED,
					errorMessage: outcomeUnknown
						? "AutoGPT did not confirm whether it accepted this task. Aira did not retry it to avoid duplicate work."
						: "AutoGPT could not accept this task.",
					completedAt: new Date(),
				},
			}),
			...(billable && !outcomeUnknown ? [refundAgentRunQuota(options.userId)] : []),
		]);
		throw error;
	}

	const persistRemoteId = () =>
		prisma.agentRun.update({
			where: { id: pendingRun.id },
			data: { remoteExecutionId },
			select: RUN_SELECT,
		});
	let submitted: SelectedRun;
	try {
		submitted = await persistRemoteId();
	} catch {
		// Retrying this local write is safe: the remote graph is not submitted again.
		submitted = await persistRemoteId();
	}
	return { run: toAgentRunDto(submitted), agentRunsRemaining: remaining };
}

export async function refreshAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({
		where: { id: runId, userId, provider: "AUTOGPT" },
	});
	if (!row) return null;
	if (isTerminal(row.status)) {
		return toAgentRunDto(row);
	}

	const stale = classifyStaleRun({
		remoteExecutionId: row.remoteExecutionId,
		createdAt: row.createdAt,
	});
	if (stale) {
		const closed = await prisma.agentRun.update({
			where: { id: row.id },
			data: {
				status: AgentRunStatus.FAILED,
				errorMessage: stale.errorMessage,
				completedAt: new Date(),
			},
			select: RUN_SELECT,
		});
		return toAgentRunDto(closed);
	}

	if (!row.remoteExecutionId) {
		return toAgentRunDto(row);
	}
	if (Date.now() - row.updatedAt.getTime() < ACTIVE_SYNC_INTERVAL_MS) {
		return toAgentRunDto(row);
	}

	const config = getAutoGptConfig();
	const remote = await getAutoGptExecution(config, row.graphId, row.remoteExecutionId);
	const status = statusFromProvider(remote.status);
	const completedAt = isTerminal(status) ? row.completedAt ?? new Date() : null;
	const storedOutput = safeStoredOutput(remote.output);
	const result =
		status === AgentRunStatus.COMPLETED
			? ((storedOutput === null ? { output: null } : storedOutput) as Prisma.InputJsonValue)
			: undefined;
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			...(result !== undefined ? { result } : {}),
			...(status === AgentRunStatus.FAILED
				? { errorMessage: "AutoGPT reported that this task failed." }
				: {}),
			completedAt,
		},
		select: RUN_SELECT,
	});
	return toAgentRunDto(updated);
}

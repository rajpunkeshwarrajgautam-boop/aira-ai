import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import { classifyStaleRun } from "@/lib/agents/run-reconciliation";
import { toAgentRunDto, type AgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";

import { AaeRequestError, cancelAaeJob, createAaeJob, getAaeJob, type AaeJob } from "./client";
import { getAaeConfig } from "./config";

const ACTIVE_SYNC_INTERVAL_MS = 2_500;
const GRAPH_ID = "aira-autonomous-agent-engine";
const GRAPH_VERSION = 1;

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

function statusFromProvider(status: AaeJob["status"]): AgentRunStatus {
	switch (status) {
		case "QUEUED":
			return AgentRunStatus.QUEUED;
		case "RUNNING":
			return AgentRunStatus.RUNNING;
		case "COMPLETED":
			return AgentRunStatus.COMPLETED;
		case "FAILED":
			return AgentRunStatus.FAILED;
		case "TERMINATED":
			return AgentRunStatus.TERMINATED;
	}
}

function isTerminal(status: AgentRunStatus): boolean {
	return (
		status === AgentRunStatus.COMPLETED ||
		status === AgentRunStatus.FAILED ||
		status === AgentRunStatus.TERMINATED
	);
}

function resultFromJob(job: AaeJob): Prisma.InputJsonValue {
	return {
		output: job.output ?? null,
		modifiedFiles: [...(job.modified_files ?? [])].slice(0, 500),
		usage: { ...(job.usage ?? {}) },
	};
}

async function idempotentSubmit(
	userId: string,
	runId: string,
	objective: string,
): Promise<AaeJob | null> {
	const config = getAaeConfig();
	try {
		return await createAaeJob(config, userId, runId, objective);
	} catch (error) {
		if (!(error instanceof AaeRequestError) || !error.submissionOutcomeUnknown) throw error;
		// AAE job ids are chosen by AIRA. Repeating this exact submission cannot
		// create a duplicate remote job, so one retry is safe even when the first
		// response disappeared after the runner accepted it.
		try {
			return await createAaeJob(config, userId, runId, objective);
		} catch (retryError) {
			if (retryError instanceof AaeRequestError && retryError.submissionOutcomeUnknown) {
				console.warn("[aae:submission-unconfirmed]", JSON.stringify({ runId }));
				return null;
			}
			throw retryError;
		}
	}
}

export async function submitAaeAgentRun(options: {
	readonly userId: string;
	readonly clientRequestId: string;
	readonly objective: string;
}): Promise<{ readonly run: AgentRunDto; readonly agentRunsRemaining: number }> {
	getAaeConfig();
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
		return { run: toAgentRunDto(existing), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let pendingRun: SelectedRun;
	try {
		pendingRun = await prisma.agentRun.create({
			data: {
				userId: options.userId,
				clientRequestId: options.clientRequestId,
				provider: "AAE",
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
		return { run: toAgentRunDto(concurrent), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let remaining: number;
	try {
		const entitlements = await consumeAgentRunQuota(options.userId);
		remaining = entitlements.agentRunsRemaining;
	} catch (error) {
		await prisma.agentRun.delete({ where: { id: pendingRun.id } }).catch(() => undefined);
		throw error;
	}

	// The remote id is deterministic and known before network submission. Persist
	// it first so a lost HTTP response can still be reconciled without resubmitting
	// paid work under a different id.
	await prisma.agentRun.update({
		where: { id: pendingRun.id },
		data: { remoteExecutionId: pendingRun.id },
	});

	let remote: AaeJob | null;
	try {
		remote = await idempotentSubmit(options.userId, pendingRun.id, options.objective);
	} catch (error) {
		await Promise.allSettled([
			prisma.agentRun.update({
				where: { id: pendingRun.id },
				data: {
					status: AgentRunStatus.FAILED,
					errorMessage: "AIRA Autonomous Agent Engine could not accept this task.",
					completedAt: new Date(),
				},
			}),
			refundAgentRunQuota(options.userId),
		]);
		throw error;
	}

	if (remote === null) {
		const queued = await prisma.agentRun.findUniqueOrThrow({
			where: { id: pendingRun.id },
			select: RUN_SELECT,
		});
		return { run: toAgentRunDto(queued), agentRunsRemaining: remaining };
	}

	const status = statusFromProvider(remote.status);
	const submitted = await prisma.agentRun.update({
		where: { id: pendingRun.id },
		data: {
			status,
			...(status === AgentRunStatus.COMPLETED ? { result: resultFromJob(remote), completedAt: new Date() } : {}),
			...(status === AgentRunStatus.FAILED
				? { errorMessage: "AIRA Autonomous Agent Engine reported that this task failed.", completedAt: new Date() }
				: {}),
			...(status === AgentRunStatus.TERMINATED ? { completedAt: new Date() } : {}),
		},
		select: RUN_SELECT,
	});
	return { run: toAgentRunDto(submitted), agentRunsRemaining: remaining };
}

export async function refreshAaeAgentRun(userId: string, runId: string): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({ where: { id: runId, userId, provider: "AAE" } });
	if (!row) return null;
	if (isTerminal(row.status)) return toAgentRunDto(row);

	const stale = classifyStaleRun({
		remoteExecutionId: row.remoteExecutionId,
		createdAt: row.createdAt,
	});
	if (stale) {
		const closed = await prisma.agentRun.update({
			where: { id: row.id },
			data: { status: AgentRunStatus.FAILED, errorMessage: stale.errorMessage, completedAt: new Date() },
			select: RUN_SELECT,
		});
		return toAgentRunDto(closed);
	}
	if (!row.remoteExecutionId) return toAgentRunDto(row);
	if (Date.now() - row.updatedAt.getTime() < ACTIVE_SYNC_INTERVAL_MS) return toAgentRunDto(row);

	const remote = await getAaeJob(getAaeConfig(), userId, row.remoteExecutionId);
	const status = statusFromProvider(remote.status);
	const completedAt = isTerminal(status) ? row.completedAt ?? new Date() : null;
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			...(status === AgentRunStatus.COMPLETED ? { result: resultFromJob(remote) } : {}),
			...(status === AgentRunStatus.FAILED
				? { errorMessage: "AIRA Autonomous Agent Engine reported that this task failed." }
				: {}),
			completedAt,
		},
		select: RUN_SELECT,
	});
	return toAgentRunDto(updated);
}

export async function cancelAaeAgentRun(userId: string, runId: string): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({ where: { id: runId, userId, provider: "AAE" } });
	if (!row) return null;
	if (isTerminal(row.status)) return toAgentRunDto(row);
	if (!row.remoteExecutionId) {
		const terminated = await prisma.agentRun.update({
			where: { id: row.id },
			data: { status: AgentRunStatus.TERMINATED, completedAt: new Date() },
			select: RUN_SELECT,
		});
		return toAgentRunDto(terminated);
	}

	const remote = await cancelAaeJob(getAaeConfig(), userId, row.remoteExecutionId);
	const status = statusFromProvider(remote.status);
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			...(status === AgentRunStatus.COMPLETED ? { result: resultFromJob(remote) } : {}),
			completedAt: isTerminal(status) ? row.completedAt ?? new Date() : null,
		},
		select: RUN_SELECT,
	});
	return toAgentRunDto(updated);
}

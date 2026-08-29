import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
} from "@/lib/billing/plan-enforcement";
import {
	enqueueFoundationJob,
	foundationControlPlaneConfigured,
} from "@/lib/foundation-control-plane";
import { prisma } from "@/lib/prisma";

const MANAGER_GRAPH_ID = "aira-manager";
const MANAGER_GRAPH_VERSION = 1;

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

export interface ManagedAgentRunDto {
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

export class ManagedAgentRuntimeConfigError extends Error {
	readonly code = "AIRA_MANAGER_NOT_CONFIGURED";
	constructor(message = "AIRA Manager runtime is not configured for this deployment.") {
		super(message);
		this.name = "ManagedAgentRuntimeConfigError";
	}
}

export class ManagedAgentQueueError extends Error {
	readonly code = "AIRA_MANAGER_QUEUE_UNCONFIRMED";
	readonly status = 503;
	readonly retryable = true;
	readonly run: ManagedAgentRunDto;

	constructor(run: ManagedAgentRunDto) {
		super("AIRA created the run but could not confirm Manager queue acceptance. Retry with the same request id; duplicate work is prevented.");
		this.name = "ManagedAgentQueueError";
		this.run = run;
	}
}

function toDto(run: SelectedRun): ManagedAgentRunDto {
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

export function isManagedAgentRuntimeEnabled(): boolean {
	return process.env.AIRA_MANAGER_RUNTIME_ENABLED === "true";
}

export function isManagedAgentRuntimeConfigured(): boolean {
	return (
		isManagedAgentRuntimeEnabled() &&
		process.env.AIRA_MANAGER_WORKER_ENABLED === "true" &&
		foundationControlPlaneConfigured()
	);
}

async function enqueueManagedRun(run: SelectedRun, userId: string): Promise<void> {
	if (!isManagedAgentRuntimeConfigured()) throw new ManagedAgentRuntimeConfigError();
	await enqueueFoundationJob({
		type: "agent.manager",
		jobKey: `run:${run.id}`,
		payload: {
			runId: run.id,
			userId,
		},
	});
}

export async function submitManagedAgentRun(options: {
	readonly userId: string;
	readonly clientRequestId: string;
	readonly objective: string;
}): Promise<{ readonly run: ManagedAgentRunDto; readonly agentRunsRemaining: number }> {
	if (!isManagedAgentRuntimeConfigured()) throw new ManagedAgentRuntimeConfigError();

	let run = await prisma.agentRun.findUnique({
		where: {
			userId_clientRequestId: {
				userId: options.userId,
				clientRequestId: options.clientRequestId,
			},
		},
		select: RUN_SELECT,
	});

	let createdLocally = false;
	let remaining: number;
	if (run) {
		const entitlements = await getEffectiveEntitlements(options.userId);
		remaining = entitlements.agentRunsRemaining;
	} else {
		try {
			run = await prisma.agentRun.create({
				data: {
					userId: options.userId,
					clientRequestId: options.clientRequestId,
					provider: "AIRA",
					graphId: MANAGER_GRAPH_ID,
					graphVersion: MANAGER_GRAPH_VERSION,
					objective: options.objective,
				},
				select: RUN_SELECT,
			});
			createdLocally = true;
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
			run = concurrent;
		}

		if (createdLocally) {
			try {
				const entitlements = await consumeAgentRunQuota(options.userId);
				remaining = entitlements.agentRunsRemaining;
			} catch (error) {
				await prisma.agentRun.delete({ where: { id: run.id } }).catch(() => undefined);
				throw error;
			}
		} else {
			const entitlements = await getEffectiveEntitlements(options.userId);
			remaining = entitlements.agentRunsRemaining;
		}
	}

	if (run.status === AgentRunStatus.QUEUED) {
		try {
			await enqueueManagedRun(run, options.userId);
		} catch (error) {
			console.error("[agents:manager:enqueue]", {
				runId: run.id,
				error: error instanceof Error ? error.message : "queue confirmation failed",
			});
			throw new ManagedAgentQueueError(toDto(run));
		}
	}

	return { run: toDto(run), agentRunsRemaining: remaining };
}

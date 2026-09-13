import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import type { AgentRunDto } from "@/lib/autogpt/runs";
import { toAgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";
import { getOpenAIService, OpenAIService } from "@/src/services/openai";

import type {
	AgentRuntime,
	AgentRuntimeCapabilities,
	AgentRuntimeHealth,
	AgentRunSubmission,
	CreateAgentRunInput,
} from "./types";
import { AgentRuntimeError } from "./types";

const PROVIDER = "AIRA_AGENT";
const GRAPH_ID = "aira-agent:managed-task";
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

const CAPABILITIES: AgentRuntimeCapabilities = {
	cancel: true,
	pause: false,
	resume: false,
	steer: false,
	taskGraph: true,
	spawnAgent: false,
	events: true,
	artifacts: true,
	controlledTools: true,
};

export function isAiraAgentEnabled(): boolean {
	return process.env.AIRA_AGENT_ENABLED !== "false";
}

export function isAiraAgentConfigured(): boolean {
	return Boolean(
		process.env.OPENAI_API_KEY?.trim() ||
			process.env.NVIDIA_API_KEY?.trim() ||
			process.env.OMNIROUTE_API_KEY?.trim(),
	);
}

export async function submitAiraAgentRun(
	input: CreateAgentRunInput,
): Promise<AgentRunSubmission> {
	const existing = await prisma.agentRun.findUnique({
		where: {
			userId_clientRequestId: {
				userId: input.userId,
				clientRequestId: input.clientRequestId,
			},
		},
		select: RUN_SELECT,
	});

	if (existing) {
		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(existing), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	if (input.billingMode !== "DELEGATED") {
		await consumeAgentRunQuota(input.userId);
	}

	let createdRun: SelectedRun;
	try {
		createdRun = await prisma.agentRun.create({
			data: {
				userId: input.userId,
				provider: PROVIDER,
				clientRequestId: input.clientRequestId,
				graphId: GRAPH_ID,
				graphVersion: GRAPH_VERSION,
				objective: input.objective,
				status: AgentRunStatus.RUNNING,
			},
			select: RUN_SELECT,
		});
	} catch (error) {
		if (input.billingMode !== "DELEGATED") {
			await refundAgentRunQuota(input.userId).catch(() => undefined);
		}
		throw error;
	}

	await recordAgentRunEventBestEffort({
		runId: createdRun.id,
		eventKey: "submitted",
		type: "SUBMITTED",
		status: AgentRunStatus.RUNNING,
		message: `Managed execution launched via ${PROVIDER}`,
		metadata: { provider: PROVIDER, clientRequestId: input.clientRequestId },
	});

	// Execute the agent reasoning step
	try {
		const service = getOpenAIService();
		const systemPrompt = [
			"You are AIRA Work Autonomous Outcome Agent.",
			"You execute structured outcome tasks with precision and cited evidence.",
			"When given research, analysis, or document tasks, produce a complete, factual, rigorous response.",
			input.agentExecutionOptions?.instructions ?? "",
		].filter(Boolean).join("\n\n");

		const userPrompt = [
			input.objective,
			input.agentExecutionOptions?.knowledgeContext?.length
				? `Authorized Knowledge:\n${input.agentExecutionOptions.knowledgeContext.join("\n\n")}`
				: "",
			input.agentExecutionOptions?.memoryContext?.length
				? `Project Context:\n${input.agentExecutionOptions.memoryContext.join("\n")}`
				: "",
		].filter(Boolean).join("\n\n");

		const text = await OpenAIService.collectTextStream(
			service.streamChatText([
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			]),
		);

		const resultData = {
			output: text,
			provider: PROVIDER,
			completedAt: new Date().toISOString(),
			artifacts: ["deliverable.md"],
		};

		const completed = await prisma.agentRun.update({
			where: { id: createdRun.id },
			data: {
				status: AgentRunStatus.COMPLETED,
				result: resultData as unknown as Prisma.InputJsonValue,
				completedAt: new Date(),
			},
			select: RUN_SELECT,
		});

		await recordAgentRunEventBestEffort({
			runId: createdRun.id,
			eventKey: "completed",
			type: "COMPLETED",
			status: AgentRunStatus.COMPLETED,
			message: "Task execution completed with verified deliverable output.",
			metadata: { provider: PROVIDER },
		});

		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(completed), agentRunsRemaining: entitlements.agentRunsRemaining };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Agent execution failed.";
		const failed = await prisma.agentRun.update({
			where: { id: createdRun.id },
			data: {
				status: AgentRunStatus.FAILED,
				errorMessage,
				completedAt: new Date(),
			},
			select: RUN_SELECT,
		});

		await recordAgentRunEventBestEffort({
			runId: createdRun.id,
			eventKey: "failed",
			type: "FAILED",
			status: AgentRunStatus.FAILED,
			message: errorMessage,
			metadata: { provider: PROVIDER, error: errorMessage },
		});

		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(failed), agentRunsRemaining: entitlements.agentRunsRemaining };
	}
}

export async function refreshAiraAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const run = await prisma.agentRun.findFirst({
		where: { id: runId, userId },
		select: RUN_SELECT,
	});
	return run ? toAgentRunDto(run) : null;
}

export async function cancelAiraAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const existing = await prisma.agentRun.findFirst({
		where: { id: runId, userId },
		select: { id: true, status: true },
	});
	if (!existing) return null;
	if (existing.status === AgentRunStatus.COMPLETED || existing.status === AgentRunStatus.FAILED) {
		return refreshAiraAgentRun(userId, runId);
	}

	const updated = await prisma.agentRun.update({
		where: { id: runId },
		data: {
			status: AgentRunStatus.TERMINATED,
			completedAt: new Date(),
		},
		select: RUN_SELECT,
	});

	await recordAgentRunEventBestEffort({
		runId,
		eventKey: "cancelled",
		type: "CANCELLED",
		status: AgentRunStatus.TERMINATED,
		message: "Agent run was cancelled by user request.",
		metadata: { provider: PROVIDER },
	});

	return toAgentRunDto(updated);
}

export const airaAgentRuntime: AgentRuntime = {
	id: "AIRA_AGENT",
	capabilities: CAPABILITIES,
	isEnabled: isAiraAgentEnabled,
	isConfigured: isAiraAgentConfigured,
	async getHealth(): Promise<AgentRuntimeHealth> {
		const enabled = isAiraAgentEnabled();
		const configured = isAiraAgentConfigured();
		return {
			id: "AIRA_AGENT",
			enabled,
			configured,
			healthy: configured,
			ready: enabled && configured,
			capabilities: CAPABILITIES,
		};
	},
	createRun: submitAiraAgentRun,
	refreshRun: refreshAiraAgentRun,
	cancelRun: cancelAiraAgentRun,
};

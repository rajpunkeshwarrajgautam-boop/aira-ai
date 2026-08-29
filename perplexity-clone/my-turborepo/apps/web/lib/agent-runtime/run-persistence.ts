import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import type { ExecutionPlan } from "./planner";
import type { RuntimeTask, TaskGraph } from "./types";
import type { RuntimeTaskExecutionResult } from "./manager-runtime";

const MAX_MESSAGE_CHARS = 24_000;
const MAX_STORAGE_REF_CHARS = 4_000;
const MAX_ARTIFACT_NAME_CHARS = 240;

function bounded(value: string, max: number): string {
	return value.trim().slice(0, max);
}

function asInputJson(value: unknown): Prisma.InputJsonValue | undefined {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

function taskData(task: RuntimeTask) {
	return {
		title: bounded(task.title, 160),
		description: task.description ? bounded(task.description, 8_000) : null,
		role: task.role,
		dependencies: [...task.dependsOn],
		requiredCapabilities: [...(task.requiredCapabilities ?? [])],
		status: task.status,
		priority: task.priority ?? 50,
		attempt: task.attempt,
		maxAttempts: task.maxAttempts ?? null,
		delegationDepth: task.delegationDepth,
		blockedReason: task.blockedReason ? bounded(task.blockedReason, 4_000) : null,
		expectedOutput: task.expectedOutput ? bounded(task.expectedOutput, 4_000) : null,
		acceptanceCriteria: asInputJson(task.acceptanceCriteria ?? []),
		riskClass: task.riskClass ?? null,
		preferredModelClass: task.preferredModelClass ?? null,
		startedAt: task.status === "running" || task.status === "verifying" ? new Date() : undefined,
		completedAt: ["completed", "failed", "cancelled"].includes(task.status) ? new Date() : null,
	};
}

export async function persistExecutionPlan(runId: string, plan: ExecutionPlan): Promise<void> {
	await prisma.$transaction(
		plan.graph.tasks.map((task) =>
			prisma.agentRunTask.upsert({
				where: { runId_taskKey: { runId, taskKey: task.id } },
				create: {
					runId,
					taskKey: task.id,
					...taskData(task),
				},
				update: taskData(task),
			}),
		),
	);
}

export async function persistRuntimeTask(runId: string, task: RuntimeTask): Promise<void> {
	await prisma.agentRunTask.upsert({
		where: { runId_taskKey: { runId, taskKey: task.id } },
		create: { runId, taskKey: task.id, ...taskData(task) },
		update: taskData(task),
	});
}

export async function persistRuntimeTaskResult(
	runId: string,
	task: RuntimeTask,
	result: RuntimeTaskExecutionResult,
): Promise<void> {
	await prisma.agentRunTask.update({
		where: { runId_taskKey: { runId, taskKey: task.id } },
		data: {
			...taskData(task),
			result: asInputJson(result.output),
			evidence: asInputJson(result.evidence ?? []),
			artifactRefs: asInputJson(result.artifacts ?? []),
		},
	});
}

export async function loadPersistedTaskGraph(
	userId: string,
	runId: string,
): Promise<TaskGraph | null> {
	const rows = await prisma.agentRunTask.findMany({
		where: { runId, run: { userId } },
		orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
	});
	if (rows.length === 0) return null;
	return {
		tasks: rows.map((row) => ({
			id: row.taskKey,
			title: row.title,
			...(row.description ? { description: row.description } : {}),
			role: row.role as RuntimeTask["role"],
			dependsOn: row.dependencies,
			requiredCapabilities: row.requiredCapabilities,
			...(row.expectedOutput ? { expectedOutput: row.expectedOutput } : {}),
			acceptanceCriteria: asStringArray(row.acceptanceCriteria),
			...(row.riskClass ? { riskClass: row.riskClass as RuntimeTask["riskClass"] } : {}),
			...(row.preferredModelClass
				? { preferredModelClass: row.preferredModelClass as RuntimeTask["preferredModelClass"] }
				: {}),
			status: row.status as RuntimeTask["status"],
			priority: row.priority,
			attempt: row.attempt,
			...(row.maxAttempts ? { maxAttempts: row.maxAttempts } : {}),
			delegationDepth: row.delegationDepth,
			...(row.blockedReason ? { blockedReason: row.blockedReason } : {}),
		})),
	};
}

export interface AgentRunMessageInput {
	readonly runId: string;
	readonly taskKey?: string;
	readonly senderRole: string;
	readonly recipientRole?: string;
	readonly messageType: string;
	readonly content: string;
	readonly artifactRefs?: readonly string[];
}

export async function recordAgentRunMessage(input: AgentRunMessageInput): Promise<string> {
	const row = await prisma.agentRunMessage.create({
		data: {
			runId: input.runId,
			taskKey: input.taskKey ? bounded(input.taskKey, 64) : null,
			senderRole: bounded(input.senderRole, 80),
			recipientRole: input.recipientRole ? bounded(input.recipientRole, 80) : null,
			messageType: bounded(input.messageType, 80),
			content: bounded(input.content, MAX_MESSAGE_CHARS),
			artifactRefs: asInputJson(input.artifactRefs ?? []),
		},
		select: { id: true },
	});
	return row.id;
}

export interface AgentRunArtifactInput {
	readonly runId: string;
	readonly taskKey?: string;
	readonly agentRole?: string;
	readonly type: string;
	readonly name: string;
	readonly storageRef: string;
	readonly contentType?: string;
	readonly sizeBytes?: number;
	readonly metadata?: unknown;
}

export async function recordAgentRunArtifact(input: AgentRunArtifactInput): Promise<string> {
	if (input.sizeBytes !== undefined && (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0)) {
		throw new Error("Artifact sizeBytes must be a non-negative safe integer.");
	}
	const row = await prisma.agentRunArtifact.create({
		data: {
			runId: input.runId,
			taskKey: input.taskKey ? bounded(input.taskKey, 64) : null,
			agentRole: input.agentRole ? bounded(input.agentRole, 80) : null,
			type: bounded(input.type, 80),
			name: bounded(input.name, MAX_ARTIFACT_NAME_CHARS),
			storageRef: bounded(input.storageRef, MAX_STORAGE_REF_CHARS),
			contentType: input.contentType ? bounded(input.contentType, 160) : null,
			sizeBytes: input.sizeBytes ?? null,
			metadata: asInputJson(input.metadata),
		},
		select: { id: true },
	});
	return row.id;
}

export async function listAgentRunArtifacts(userId: string, runId: string, limit = 100) {
	return prisma.agentRunArtifact.findMany({
		where: { runId, run: { userId } },
		orderBy: { createdAt: "asc" },
		take: Math.min(200, Math.max(1, limit)),
		select: {
			id: true,
			taskKey: true,
			agentRole: true,
			type: true,
			name: true,
			storageRef: true,
			contentType: true,
			sizeBytes: true,
			metadata: true,
			createdAt: true,
		},
	});
}

export async function listAgentRunMessages(userId: string, runId: string, limit = 200) {
	return prisma.agentRunMessage.findMany({
		where: { runId, run: { userId } },
		orderBy: { createdAt: "asc" },
		take: Math.min(300, Math.max(1, limit)),
		select: {
			id: true,
			taskKey: true,
			senderRole: true,
			recipientRole: true,
			messageType: true,
			content: true,
			artifactRefs: true,
			createdAt: true,
		},
	});
}

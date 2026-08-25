import type { Prisma } from "@/generated/prisma/client";
import type { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { recordAgentRunEventBestEffort } from "./run-events";

export type AgentRunStepStatus =
	| "PENDING"
	| "RUNNING"
	| "WAITING_FOR_REVIEW"
	| "WAITING_FOR_APPROVAL"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED"
	| "TIMED_OUT";

export interface AgentRunStepDto {
	readonly stepKey: string;
	readonly type: string;
	readonly label: string;
	readonly status: AgentRunStepStatus;
	readonly attempt: number;
	readonly toolId: string | null;
	readonly errorCode: string | null;
	readonly startedAt: string | null;
	readonly completedAt: string | null;
	readonly updatedAt: string;
}

export interface RecordAgentRunStepOptions {
	readonly runId: string;
	readonly stepKey: string;
	readonly type: string;
	readonly label: string;
	readonly status: AgentRunStepStatus;
	readonly attempt?: number;
	readonly toolId?: string | null;
	readonly errorCode?: string | null;
}

type StepEventMetadata = {
	stepKey: string;
	stepType: string;
	label: string;
	stepStatus: AgentRunStepStatus;
	attempt: number;
	toolId?: string;
	errorCode?: string;
};

const STEP_EVENT_SELECT = {
	metadata: true,
	createdAt: true,
} satisfies Prisma.AgentRunEventSelect;

type SelectedStepEvent = Prisma.AgentRunEventGetPayload<{ select: typeof STEP_EVENT_SELECT }>;

const TERMINAL_STEP_STATUSES = new Set<AgentRunStepStatus>([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"TIMED_OUT",
]);

function bounded(value: string, max: number): string {
	return value.trim().slice(0, max);
}

function safeAttempt(value: number | undefined): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(100, Math.max(1, Math.trunc(value ?? 1)));
}

function isStepStatus(value: unknown): value is AgentRunStepStatus {
	return (
		value === "PENDING" ||
		value === "RUNNING" ||
		value === "WAITING_FOR_REVIEW" ||
		value === "WAITING_FOR_APPROVAL" ||
		value === "COMPLETED" ||
		value === "FAILED" ||
		value === "CANCELLED" ||
		value === "TIMED_OUT"
	);
}

function parseMetadata(value: Prisma.JsonValue): StepEventMetadata | null {
	if (!value || Array.isArray(value) || typeof value !== "object") return null;
	const record = value as Record<string, Prisma.JsonValue>;
	if (
		typeof record.stepKey !== "string" ||
		typeof record.stepType !== "string" ||
		typeof record.label !== "string" ||
		!isStepStatus(record.stepStatus) ||
		typeof record.attempt !== "number"
	) {
		return null;
	}
	return {
		stepKey: record.stepKey,
		stepType: record.stepType,
		label: record.label,
		stepStatus: record.stepStatus,
		attempt: safeAttempt(record.attempt),
		...(typeof record.toolId === "string" ? { toolId: record.toolId } : {}),
		...(typeof record.errorCode === "string" ? { errorCode: record.errorCode } : {}),
	};
}

export function agentRunStatusToStepStatus(status: AgentRunStatus): AgentRunStepStatus {
	switch (status) {
		case "QUEUED":
			return "PENDING";
		case "RUNNING":
			return "RUNNING";
		case "REVIEW":
			return "WAITING_FOR_REVIEW";
		case "COMPLETED":
			return "COMPLETED";
		case "FAILED":
			return "FAILED";
		case "TERMINATED":
			return "CANCELLED";
	}
}

export async function recordAgentRunStepBestEffort(
	options: RecordAgentRunStepOptions,
): Promise<void> {
	const stepKey = bounded(options.stepKey, 160);
	const type = bounded(options.type, 80);
	const label = bounded(options.label, 240);
	const toolId = options.toolId ? bounded(options.toolId, 100) : undefined;
	const errorCode = options.errorCode ? bounded(options.errorCode, 100) : undefined;
	const attempt = safeAttempt(options.attempt);
	if (!stepKey || !type || !label) {
		console.error("[agents:run-steps:invalid]", { runId: options.runId, stepKey, type });
		return;
	}

	await recordAgentRunEventBestEffort({
		runId: options.runId,
		eventKey: `step:${stepKey}:${attempt}:${options.status}`,
		type: "RUN_STEP",
		message: `${label}: ${options.status.toLowerCase().replaceAll("_", " ")}.`,
		metadata: {
			stepKey,
			stepType: type,
			label,
			stepStatus: options.status,
			attempt,
			...(toolId ? { toolId } : {}),
			...(errorCode ? { errorCode } : {}),
		},
	});
}

export async function listAgentRunSteps(
	userId: string,
	runId: string,
	limit = 100,
): Promise<AgentRunStepDto[]> {
	const events = await prisma.agentRunEvent.findMany({
		where: { runId, type: "RUN_STEP", run: { userId } },
		orderBy: { createdAt: "asc" },
		take: Math.min(300, Math.max(1, limit * 4)),
		select: STEP_EVENT_SELECT,
	});

	const steps = new Map<string, AgentRunStepDto>();
	for (const event of events) {
		const metadata = parseMetadata(event.metadata);
		if (!metadata) continue;
		const identity = `${metadata.stepKey}:${metadata.attempt}`;
		const previous = steps.get(identity);
		const timestamp = event.createdAt.toISOString();
		const startedAt =
			previous?.startedAt ??
			(metadata.stepStatus === "RUNNING" ? timestamp : null);
		const completedAt = TERMINAL_STEP_STATUSES.has(metadata.stepStatus)
			? timestamp
			: previous?.completedAt ?? null;
		steps.set(identity, {
			stepKey: metadata.stepKey,
			type: metadata.stepType,
			label: metadata.label,
			status: metadata.stepStatus,
			attempt: metadata.attempt,
			toolId: metadata.toolId ?? null,
			errorCode: metadata.errorCode ?? null,
			startedAt,
			completedAt,
			updatedAt: timestamp,
		});
	}

	return [...steps.values()].slice(-Math.min(100, Math.max(1, limit)));
}

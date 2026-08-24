import type { Prisma } from "@/generated/prisma/client";
import type { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const EVENT_SELECT = {
	id: true,
	type: true,
	status: true,
	message: true,
	metadata: true,
	createdAt: true,
} satisfies Prisma.AgentRunEventSelect;

type SelectedEvent = Prisma.AgentRunEventGetPayload<{ select: typeof EVENT_SELECT }>;

export interface AgentRunEventDto {
	readonly id: string;
	readonly type: string;
	readonly status: AgentRunStatus | null;
	readonly message: string;
	readonly metadata: unknown | null;
	readonly createdAt: string;
}

function toDto(event: SelectedEvent): AgentRunEventDto {
	return {
		id: event.id,
		type: event.type,
		status: event.status,
		message: event.message,
		metadata: event.metadata,
		createdAt: event.createdAt.toISOString(),
	};
}

export async function recordAgentRunEvent(options: {
	readonly runId: string;
	readonly eventKey: string;
	readonly type: string;
	readonly status?: AgentRunStatus | null;
	readonly message: string;
	readonly metadata?: Prisma.InputJsonValue;
}): Promise<AgentRunEventDto> {
	const event = await prisma.agentRunEvent.upsert({
		where: {
			runId_eventKey: {
				runId: options.runId,
				eventKey: options.eventKey,
			},
		},
		create: {
			runId: options.runId,
			eventKey: options.eventKey,
			type: options.type,
			status: options.status ?? null,
			message: options.message,
			...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
		},
		update: {},
		select: EVENT_SELECT,
	});
	return toDto(event);
}

export async function listAgentRunEvents(
	userId: string,
	runId: string,
	limit = 40,
): Promise<AgentRunEventDto[]> {
	const events = await prisma.agentRunEvent.findMany({
		where: {
			runId,
			run: { userId },
		},
		orderBy: { createdAt: "asc" },
		take: Math.min(100, Math.max(1, limit)),
		select: EVENT_SELECT,
	});
	return events.map(toDto);
}

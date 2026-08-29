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

export interface RecordAgentRunEventOptions {
	readonly runId: string;
	readonly eventKey: string;
	readonly type: string;
	readonly status?: AgentRunStatus | null;
	readonly message: string;
	readonly metadata?: Prisma.InputJsonValue;
}

function publicEventMetadata(event: SelectedEvent): unknown | null {
	// Remote provider handles are restart-recovery state, not client-facing data.
	// Keep the checkpoint event itself visible in the lifecycle while withholding
	// its private metadata from the authenticated events API.
	if (event.type === "CHECKPOINT_REMOTE_ACCEPTED") return null;
	return event.metadata;
}

function toDto(event: SelectedEvent): AgentRunEventDto {
	return {
		id: event.id,
		type: event.type,
		status: event.status,
		message: event.message,
		metadata: publicEventMetadata(event),
		createdAt: event.createdAt.toISOString(),
	};
}

export async function recordAgentRunEvent(
	options: RecordAgentRunEventOptions,
): Promise<AgentRunEventDto> {
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

/**
 * Lifecycle history must never turn a successfully accepted autonomous task into
 * a client-visible submission failure. We await the attempt so serverless work is
 * not abandoned, but degrade to structured server logging if persistence fails.
 */
export async function recordAgentRunEventBestEffort(
	options: RecordAgentRunEventOptions,
): Promise<void> {
	try {
		await recordAgentRunEvent(options);
	} catch (error) {
		console.error("[agents:run-events:record]", {
			runId: options.runId,
			type: options.type,
			error: error instanceof Error ? error.message : "unknown event persistence failure",
		});
	}
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

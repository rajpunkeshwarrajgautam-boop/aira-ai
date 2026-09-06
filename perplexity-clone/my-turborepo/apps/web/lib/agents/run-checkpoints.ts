import type { Prisma } from "@/generated/prisma/client";
import type { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { recordAgentRunEvent, recordAgentRunEventBestEffort } from "./run-events";

const REMOTE_ACCEPTED_EVENT = "CHECKPOINT_REMOTE_ACCEPTED";
const CHECKPOINT_VERSION = 1;

function metadataForRemoteCheckpoint(
	provider: string,
	remoteExecutionId: string,
): Prisma.InputJsonObject {
	return {
		checkpointVersion: CHECKPOINT_VERSION,
		provider,
		remoteExecutionId,
	};
}

function parseRemoteCheckpointMetadata(
	value: Prisma.JsonValue | null,
	expectedProvider: string,
): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const checkpointVersion = value.checkpointVersion;
	const provider = value.provider;
	const remoteExecutionId = value.remoteExecutionId;
	if (checkpointVersion !== CHECKPOINT_VERSION) return null;
	if (provider !== expectedProvider) return null;
	if (typeof remoteExecutionId !== "string" || !remoteExecutionId.trim()) return null;
	return remoteExecutionId;
}

/**
 * Persist the provider handle before relying on the mutable AgentRun row.
 *
 * If a serverless invocation is interrupted between remote acceptance and the
 * AgentRun update, this immutable event is sufficient to reconnect to the exact
 * same remote execution later. It must never be used to submit duplicate work.
 */
export async function recordRemoteAcceptedCheckpoint(options: {
	readonly runId: string;
	readonly provider: string;
	readonly remoteExecutionId: string;
	readonly status: AgentRunStatus;
}): Promise<void> {
	await recordAgentRunEvent({
		runId: options.runId,
		eventKey: "checkpoint:remote-accepted",
		type: REMOTE_ACCEPTED_EVENT,
		status: options.status,
		message: "AIRA saved a restart checkpoint for the accepted remote execution.",
		metadata: metadataForRemoteCheckpoint(options.provider, options.remoteExecutionId),
	});
}

/**
 * Recover a missing provider handle from the immutable checkpoint and repair the
 * mutable AgentRun row. Ownership and provider identity are checked before the
 * repair. A unique-provider-handle conflict is allowed to surface rather than
 * silently attaching a run to the wrong remote execution.
 */
export async function recoverRemoteExecutionIdFromCheckpoint(options: {
	readonly userId: string;
	readonly runId: string;
	readonly provider: string;
}): Promise<string | null> {
	const checkpoint = await prisma.agentRunEvent.findFirst({
		where: {
			runId: options.runId,
			type: REMOTE_ACCEPTED_EVENT,
			run: { userId: options.userId, provider: options.provider },
		},
		orderBy: { createdAt: "desc" },
		select: { metadata: true },
	});
	const remoteExecutionId = parseRemoteCheckpointMetadata(
		checkpoint?.metadata ?? null,
		options.provider,
	);
	if (!remoteExecutionId) return null;

	const repaired = await prisma.agentRun.updateMany({
		where: {
			id: options.runId,
			userId: options.userId,
			provider: options.provider,
			remoteExecutionId: null,
		},
		data: { remoteExecutionId },
	});
	if (repaired.count === 0) {
		const current = await prisma.agentRun.findFirst({
			where: { id: options.runId, userId: options.userId, provider: options.provider },
			select: { remoteExecutionId: true },
		});
		return current?.remoteExecutionId ?? null;
	}

	await recordAgentRunEventBestEffort({
		runId: options.runId,
		eventKey: "checkpoint:remote-recovered",
		type: "CHECKPOINT_RECOVERED",
		message: "AIRA recovered the saved remote execution checkpoint and resumed status reconciliation.",
		metadata: { provider: options.provider },
	});
	return remoteExecutionId;
}

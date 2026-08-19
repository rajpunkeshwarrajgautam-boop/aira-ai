import { randomUUID } from "node:crypto";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

type TraceMetadata = Readonly<Record<string, string | number | boolean | null | undefined>>;

function safeRequestId(candidate: string | null | undefined): string {
	const trimmed = candidate?.trim();
	return trimmed && SAFE_REQUEST_ID.test(trimmed) ? trimmed : randomUUID();
}

function cleanMetadata(metadata: TraceMetadata): Record<string, string | number | boolean | null> {
	const clean: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (value === undefined) continue;
		clean[key] = value;
	}
	return clean;
}

/**
 * Lightweight, PII-avoiding runtime trace for hosted/serverless execution.
 * Do not pass raw prompts, answers, memory text, tokens, credentials, or source excerpts
 * as metadata. Correlation IDs and stage timings are enough for operational debugging.
 */
export class AiraRuntimeTrace {
	readonly requestId: string;
	private readonly startedAt = Date.now();
	private lastMarkAt = this.startedAt;

	constructor(incomingRequestId?: string | null) {
		this.requestId = safeRequestId(incomingRequestId);
	}

	mark(stage: string, metadata: TraceMetadata = {}): void {
		const now = Date.now();
		console.info(
			"[AIRA runtime]",
			JSON.stringify({
				requestId: this.requestId,
				stage,
				elapsedMs: now - this.startedAt,
				stageMs: now - this.lastMarkAt,
				...cleanMetadata(metadata),
			}),
		);
		this.lastMarkAt = now;
	}

	finish(outcome: "success" | "error" | "aborted", metadata: TraceMetadata = {}): void {
		const now = Date.now();
		console.info(
			"[AIRA runtime]",
			JSON.stringify({
				requestId: this.requestId,
				stage: "complete",
				outcome,
				elapsedMs: now - this.startedAt,
				...cleanMetadata(metadata),
			}),
		);
	}
}

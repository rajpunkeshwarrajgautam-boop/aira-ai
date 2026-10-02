import { createHash } from "node:crypto";

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function normalizedSubject(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}._-]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Prefer a stable slot key for explicit assignment-style memories so a later
 * correction updates the same durable fact instead of creating a conflicting
 * pinned memory. Free-form memories keep the legacy content-addressed behavior.
 */
export function manualMemoryKeyForContent(content: string): string {
	const normalized = content.trim().replace(/\s+/g, " ");
	const assignment = normalized.match(
		/^(.{3,160}?)\s+(?:is|are|should be|defaults? to|=)\s+(.{1,600})$/i,
	);
	if (assignment) {
		const subjectSource = assignment[1];
		if (typeof subjectSource === "string") {
			const subject = normalizedSubject(subjectSource);
			if (subject.split(/\s+/).filter(Boolean).length >= 2) {
				return `manual.slot.${digest(subject)}`;
			}
		}
	}
	return `manual.${digest(normalized.toLowerCase())}`;
}

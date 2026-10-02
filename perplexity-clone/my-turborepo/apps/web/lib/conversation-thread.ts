export interface ConversationThreadNode {
	readonly id: string;
	readonly parentMessageId: string | null;
	readonly role: string;
	readonly content: string;
}

const THREAD_REFERENCE_PATTERNS: readonly RegExp[] = [
	/\b(?:it|this|that|these|those|them|its|their|above|previous answer|last answer|earlier answer)\b/i,
	/\b(?:first|second|third|fourth|fifth)\s+(?:one|point|item|example|option)\b/i,
	/^(?:make|shorten|expand|simplify|summari[sz]e|rewrite|rephrase|convert|turn)\b/i,
	/^(?:give|create|make)\s+(?:me\s+)?(?:notes|a summary|summary|bullet points|bullets|mcqs?|questions|a quiz|quiz|flashcards?)\b/i,
	/^explain\s+(?:it|this|that|these|those|them|the\s+(?:first|second|third|fourth|fifth)\s+(?:one|point|item|example|option))\b/i,
];

const MEMORY_DISABLED_PATTERNS: readonly RegExp[] = [
	/\b(?:do not|don't|dont)\s+(?:remember|store|save|use memory)\b/i,
	/\b(?:private session|private mode|no memory|without memory|memory off)\b/i,
];

const MEMORY_WRITE_PATTERNS: readonly RegExp[] = [
	/\bremember\s+(?:that|this)\b/i,
	/\b(?:from now on|going forward|always|default to)\b/i,
	/\bmy preference is\b/i,
	/\b(?:this|our) project must\b/i,
	/\bwe (?:decided|agreed) to\b/i,
	/\b(?:save|store) (?:this|that) (?:preference|decision|constraint|rule|context)\b/i,
	/\b(?:change|update|replace)\s+what\s+you\s+remember\s+about\s+my\b/i,
];

/**
 * Conservative detector for requests whose meaning comes primarily from the active chat.
 * It is only used when a verified conversation thread already exists.
 */
export function isThreadLocalFollowUp(raw: string): boolean {
	const text = raw.trim().replace(/\s+/g, " ");
	if (!text || text.length > 600) return false;
	return THREAD_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isMemoryDisabledRequest(raw: string): boolean {
	const text = raw.trim().replace(/\s+/g, " ");
	return MEMORY_DISABLED_PATTERNS.some((pattern) => pattern.test(text));
}

export function isExplicitDurableMemoryRequest(raw: string): boolean {
	if (isMemoryDisabledRequest(raw)) return false;
	const text = raw.trim().replace(/\s+/g, " ");
	return MEMORY_WRITE_PATTERNS.some((pattern) => pattern.test(text));
}

export function canonicalDurableMemoryText(raw: string): string {
	let original = raw.trim().replace(/\s+/g, " ");
	if (!original) return "";
	original = original.replace(/^actually[,:]?\s*/i, "");

	const correction = original.match(
		/^(?:please\s+)?(?:change|update|replace)\s+what\s+you\s+remember\s+about\s+my\s+(.+?)\s+to\s+(.+?)(?:\s+instead)?[.!]?$/i,
	);
	if (correction) {
		const correctionSubject = correction[1];
		const correctionValue = correction[2];
		if (typeof correctionSubject === "string" && typeof correctionValue === "string") {
			const subject = correctionSubject.trim();
			const value = correctionValue.trim();
			if (subject && value) return `my ${subject} is ${value}`;
		}
	}

	const stripped = original
		.replace(/^(?:please\s+)?remember\s+(?:that|this)\s*[:,-]?\s*/i, "")
		.replace(
			/^(?:please\s+)?(?:save|store)\s+(?:this|that)\s+(?:preference|decision|constraint|rule|context)\s*[:,-]?\s*/i,
			"",
		)
		.replace(/\s+instead[.!]?$/i, "")
		.trim();
	return stripped || original;
}

/**
 * Resolve the exact active conversation branch, including the parent message itself.
 * The client sends the previous assistant message id as parentMessageId for a follow-up.
 */
export async function walkConversationAncestry<T extends ConversationThreadNode>(args: {
	readonly parentMessageId: string;
	readonly limit: number;
	readonly loadMessage: (id: string) => Promise<T | null>;
}): Promise<T[]> {
	const limit = Math.max(1, Math.min(30, Math.trunc(args.limit)));
	const reverseChain: T[] = [];
	const seen = new Set<string>();
	let cursorMessageId: string | null = args.parentMessageId;

	while (cursorMessageId && reverseChain.length < limit) {
		if (seen.has(cursorMessageId)) {
			throw new Error("Conversation message ancestry contains a cycle.");
		}
		seen.add(cursorMessageId);

		const message = await args.loadMessage(cursorMessageId);
		if (!message) {
			throw new Error("Conversation parent message was not found in the active thread.");
		}
		reverseChain.push(message);
		cursorMessageId = message.parentMessageId;
	}

	return reverseChain.reverse();
}

export function toModelChatHistory(
	rows: readonly ConversationThreadNode[],
): readonly { readonly role: "user" | "assistant"; readonly content: string }[] {
	return rows
		.filter(
			(row): row is ConversationThreadNode & { readonly role: "USER" | "ASSISTANT" } =>
				row.role === "USER" || row.role === "ASSISTANT",
		)
		.map((row) => ({
			role: row.role === "USER" ? ("user" as const) : ("assistant" as const),
			content: row.content,
		}));
}

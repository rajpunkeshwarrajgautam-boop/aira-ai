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

/**
 * Conservative detector for requests whose meaning comes primarily from the active chat.
 * It is only used when a verified conversation thread already exists.
 */
export function isThreadLocalFollowUp(raw: string): boolean {
	const text = raw.trim().replace(/\s+/g, " ");
	if (!text || text.length > 600) return false;
	return THREAD_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Resolve the exact active conversation branch, including the parent message itself.
 *
 * Aira's client sends the previous assistant message id as parentMessageId for a follow-up.
 * Excluding that node drops the answer that short references such as "it", "that", or
 * "the second one" depend on. Walking ancestry also prevents sibling/abandoned branches
 * from leaking into the active prompt.
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

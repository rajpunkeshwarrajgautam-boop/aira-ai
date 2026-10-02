export interface ConversationThreadNode {
	readonly id: string;
	readonly parentMessageId: string | null;
	readonly role: string;
	readonly content: string;
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

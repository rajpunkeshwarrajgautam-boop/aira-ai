import { getRelevantPersistentMemories } from "@/lib/persistent-memory";
import { prisma } from "@/lib/prisma";
import { isGreetingOnlyQuery } from "@/lib/search/no-quota-query";

import {
	isThreadLocalFollowUp,
	toModelChatHistory,
	walkConversationAncestry,
	type ConversationThreadNode,
} from "./conversation-thread";

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 10;
const DEFAULT_MEMORY_LIMIT = 8;

function normalizeQuery(input: string): string {
	return input.trim().toLowerCase().replace(/\s+/g, " ");
}

type DbThreadMessage = ConversationThreadNode & {
	readonly createdAt: Date;
};

async function loadActiveThreadHistory(args: {
	readonly userId: string;
	readonly conversationId: string;
	readonly parentMessageId?: string;
	readonly messageLimit: number;
}): Promise<readonly { readonly role: "user" | "assistant"; readonly content: string }[]> {
	const limit = Math.min(Math.max(Math.trunc(args.messageLimit), 1), 30);

	if (args.parentMessageId) {
		const rows = await walkConversationAncestry<DbThreadMessage>({
			parentMessageId: args.parentMessageId,
			limit,
			loadMessage: async (id) =>
				prisma.conversationMessage.findFirst({
					where: {
						id,
						userId: args.userId,
						conversationId: args.conversationId,
					},
					select: {
						id: true,
						role: true,
						content: true,
						parentMessageId: true,
						createdAt: true,
					},
				}),
		});
		return toModelChatHistory(rows);
	}

	const rows = await prisma.conversationMessage.findMany({
		where: {
			userId: args.userId,
			conversationId: args.conversationId,
		},
		orderBy: { createdAt: "desc" },
		take: limit,
		select: {
			id: true,
			role: true,
			content: true,
			parentMessageId: true,
			createdAt: true,
		},
	});
	return toModelChatHistory(rows.reverse());
}

/**
 * Thread-aware context loader used by the Aira chat/search facade.
 *
 * The active parent is included rather than excluded, so a follow-up such as
 * "give me notes of it" receives the exact preceding assistant answer. When a
 * parent id is supplied we follow only that ancestry branch, avoiding sibling
 * branch contamination. Thread-local transformations also avoid unrelated
 * background memory/research recall; the active chat is their primary source.
 */
export async function getFollowUpContext(args: {
	readonly userId: string;
	readonly query: string;
	readonly conversationId?: string;
	readonly parentMessageId?: string;
	readonly messageLimit?: number;
	readonly memoryLimit?: number;
}): Promise<{
	readonly chatHistory: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
	readonly contextualMemory: readonly string[];
	readonly resolvedConversationId?: string;
}> {
	const {
		userId,
		query,
		conversationId,
		parentMessageId,
		messageLimit = DEFAULT_CONTEXT_MESSAGE_LIMIT,
		memoryLimit = DEFAULT_MEMORY_LIMIT,
	} = args;

	if (parentMessageId && !conversationId) {
		throw new Error("A parent message requires an active conversation.");
	}

	let resolvedConversationId: string | undefined;
	let conversationSummary: string | null = null;
	if (conversationId) {
		const row = await prisma.conversation.findFirst({
			where: { id: conversationId, userId, archivedAt: null },
			select: { id: true, summary: true },
		});
		if (!row) throw new Error("Conversation not found.");
		resolvedConversationId = row.id;
		conversationSummary = row.summary;
	}

	const chatHistory = resolvedConversationId
		? await loadActiveThreadHistory({
				userId,
				conversationId: resolvedConversationId,
				...(parentMessageId ? { parentMessageId } : {}),
				messageLimit,
			})
		: [];

	const threadLocalFollowUp =
		Boolean(resolvedConversationId && chatHistory.length > 0) && isThreadLocalFollowUp(query);

	const durableMemories = threadLocalFollowUp
		? []
		: await getRelevantPersistentMemories(userId, query, memoryLimit);

	const normalized = normalizeQuery(query);
	const queryTokens = normalized.split(" ").filter((token) => token.length > 2).slice(0, 5);
	const researchCandidates =
		!threadLocalFollowUp && !isGreetingOnlyQuery(query) && queryTokens.length
			? await prisma.researchHistory.findMany({
					where: {
						userId,
						...(resolvedConversationId ? { conversationId: resolvedConversationId } : {}),
						OR: [
							{ normalizedQuery: { contains: normalized, mode: "insensitive" } },
							...queryTokens.map((token) => ({
								normalizedQuery: { contains: token, mode: "insensitive" as const },
							})),
						],
					},
					orderBy: { createdAt: "desc" },
					take: Math.min(Math.max(Math.ceil(memoryLimit / 2), 1), 4),
					select: { query: true, assistantAnswer: true },
				})
			: [];

	const contextualMemory: string[] = [];
	if (conversationSummary?.trim()) {
		contextualMemory.push(`CURRENT CONVERSATION SUMMARY:\n${conversationSummary.trim()}`);
	}
	if (durableMemories.length > 0) {
		contextualMemory.push(
			`DURABLE USER MEMORIES (relevant, may be corrected by the user's current message):\n${durableMemories
				.map((memory, index) => `${index + 1}. ${memory}`)
				.join("\n")}`,
		);
	}
	for (const item of researchCandidates) {
		contextualMemory.push(
			`PRIOR RESEARCH CONTEXT:\nQuery: ${item.query}\nAnswer: ${item.assistantAnswer.slice(0, 800)}`,
		);
	}

	return { chatHistory, contextualMemory, resolvedConversationId };
}

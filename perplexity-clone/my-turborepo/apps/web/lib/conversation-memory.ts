import { prisma } from "@/lib/prisma";
import { ConversationMessageRole } from "@/generated/prisma/enums";
import { generatePublicShareToken } from "@/lib/research-share";

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 10;
const DEFAULT_MEMORY_LIMIT = 5;

export interface ConversationSummary {
	readonly id: string;
	readonly title: string;
	readonly lastMessageAt: Date;
	readonly createdAt: Date;
}

export interface ConversationMessageDto {
	readonly id: string;
	readonly role: ConversationMessageRole;
	readonly content: string;
	readonly parentMessageId: string | null;
	readonly citations: unknown;
	readonly createdAt: Date;
}

function normalizeQuery(input: string): string {
	return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function inferTitleFromQuery(query: string): string {
	const compact = query.trim().replace(/\s+/g, " ");
	if (!compact) {
		return "Untitled conversation";
	}
	return compact.length <= 80 ? compact : compact.slice(0, 77) + "...";
}

export async function createConversation(
	userId: string,
	initialQuery?: string,
): Promise<ConversationSummary> {
	const created = await prisma.conversation.create({
		data: {
			userId,
			title: inferTitleFromQuery(initialQuery ?? ""),
		},
		select: {
			id: true,
			title: true,
			lastMessageAt: true,
			createdAt: true,
		},
	});
	return created;
}

export async function listConversations(
	userId: string,
	limit = 20,
): Promise<readonly ConversationSummary[]> {
	return prisma.conversation.findMany({
		where: { userId, archivedAt: null },
		orderBy: { lastMessageAt: "desc" },
		take: Math.min(Math.max(limit, 1), 100),
		select: {
			id: true,
			title: true,
			lastMessageAt: true,
			createdAt: true,
		},
	});
}

export async function getConversationOrThrow(
	userId: string,
	conversationId: string,
): Promise<{ readonly id: string; readonly title: string }> {
	const row = await prisma.conversation.findFirst({
		where: { id: conversationId, userId, archivedAt: null },
		select: { id: true, title: true },
	});
	if (!row) {
		throw new Error("Conversation not found.");
	}
	return row;
}

export async function listConversationMessages(
	userId: string,
	conversationId: string,
	limit = 100,
): Promise<readonly ConversationMessageDto[]> {
	await getConversationOrThrow(userId, conversationId);
	return prisma.conversationMessage.findMany({
		where: { conversationId, userId },
		orderBy: { createdAt: "asc" },
		take: Math.min(Math.max(limit, 1), 500),
		select: {
			id: true,
			role: true,
			content: true,
			parentMessageId: true,
			citations: true,
			createdAt: true,
		},
	});
}

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

	let resolvedConversationId: string | undefined;
	if (conversationId) {
		const row = await getConversationOrThrow(userId, conversationId);
		resolvedConversationId = row.id;
	}

	const chatHistoryRaw = resolvedConversationId
		? await prisma.conversationMessage.findMany({
				where: {
					userId,
					conversationId: resolvedConversationId,
					...(parentMessageId ? { id: { not: parentMessageId } } : {}),
				},
				orderBy: { createdAt: "desc" },
				take: Math.min(Math.max(messageLimit, 1), 30),
				select: { role: true, content: true },
			})
		: [];

	const chatHistory = chatHistoryRaw
		.reverse()
		.filter(
			(m): m is { role: "USER" | "ASSISTANT"; content: string } =>
				m.role === "USER" || m.role === "ASSISTANT",
		)
		.map((m): { readonly role: "user" | "assistant"; readonly content: string } => ({
			role: m.role === "USER" ? "user" : "assistant",
			content: m.content,
		}));

	const normalized = normalizeQuery(query);
	const queryTokens = normalized.split(" ").filter((t) => t.length > 2).slice(0, 5);
	const memoryCandidates = await prisma.researchHistory.findMany({
		where: {
			userId,
			OR: [
				{ normalizedQuery: { contains: normalized, mode: "insensitive" } },
				...queryTokens.map((token) => ({
					normalizedQuery: { contains: token, mode: "insensitive" as const },
				})),
			],
		},
		orderBy: { createdAt: "desc" },
		take: Math.min(Math.max(memoryLimit, 1), 10),
		select: {
			query: true,
			assistantAnswer: true,
		},
	});

	const contextualMemory = memoryCandidates.map(
		(item) => `Query: ${item.query}\nAnswer: ${item.assistantAnswer.slice(0, 800)}`,
	);

	return {
		chatHistory,
		contextualMemory,
		resolvedConversationId,
	};
}

export async function persistConversationTurn(args: {
	readonly userId: string;
	readonly query: string;
	readonly answer: string;
	readonly conversationId?: string;
	readonly parentMessageId?: string;
	readonly citations: readonly {
		readonly index: number;
		readonly url: string;
		readonly title: string;
		readonly publishedDate: string | null;
		readonly rankingScore: number;
	}[];
	readonly exaRequestId?: string;
	readonly exaSearchType?: string;
}): Promise<{
	readonly conversationId: string;
	readonly userMessageId: string;
	readonly assistantMessageId: string;
}> {
	const conversation =
		args.conversationId !== undefined
			? await getConversationOrThrow(args.userId, args.conversationId)
			: await createConversation(args.userId, args.query);

	const result = await prisma.$transaction(async (tx) => {
		const userMessage = await tx.conversationMessage.create({
			data: {
				conversationId: conversation.id,
				userId: args.userId,
				role: ConversationMessageRole.USER,
				content: args.query.trim(),
				parentMessageId: args.parentMessageId ?? null,
			},
			select: { id: true },
		});

		const assistantMessage = await tx.conversationMessage.create({
			data: {
				conversationId: conversation.id,
				userId: args.userId,
				role: ConversationMessageRole.ASSISTANT,
				content: args.answer.trim(),
				parentMessageId: userMessage.id,
				citations: args.citations,
				metadata: {
					exaRequestId: args.exaRequestId,
					exaSearchType: args.exaSearchType,
				},
			},
			select: { id: true },
		});

		await tx.researchHistory.create({
			data: {
				userId: args.userId,
				conversationId: conversation.id,
				messageId: assistantMessage.id,
				query: args.query.trim(),
				normalizedQuery: normalizeQuery(args.query),
				assistantAnswer: args.answer.trim(),
				citationCount: args.citations.length,
				citations: args.citations,
				publicShareToken: generatePublicShareToken(),
				exaRequestId: args.exaRequestId,
				exaSearchType: args.exaSearchType,
			},
		});

		await tx.conversation.update({
			where: { id: conversation.id },
			data: {
				lastMessageAt: new Date(),
				title:
					conversation.title === "Untitled conversation"
						? inferTitleFromQuery(args.query)
						: conversation.title,
			},
		});

		return {
			userMessageId: userMessage.id,
			assistantMessageId: assistantMessage.id,
		};
	});

	return {
		conversationId: conversation.id,
		userMessageId: result.userMessageId,
		assistantMessageId: result.assistantMessageId,
	};
}

export async function listResearchHistory(userId: string, limit = 30): Promise<
	readonly {
		readonly id: string;
		readonly conversationId: string | null;
		readonly query: string;
		readonly createdAt: Date;
		readonly citationCount: number;
	}[]
> {
	return prisma.researchHistory.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: Math.min(Math.max(limit, 1), 100),
		select: {
			id: true,
			conversationId: true,
			query: true,
			createdAt: true,
			citationCount: true,
		},
	});
}

import { ConversationMessageRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export interface GlobalMessageSearchResult {
	readonly id: string;
	readonly role: ConversationMessageRole;
	readonly content: string;
	readonly createdAt: Date;
	readonly conversation: {
		readonly id: string;
		readonly title: string;
	};
}

export async function searchConversationMessages(
	userId: string,
	query: string,
	limit = 40,
): Promise<readonly GlobalMessageSearchResult[]> {
	const needle = query.trim();
	if (needle.length < 2) return [];

	return prisma.conversationMessage.findMany({
		where: {
			userId,
			content: { contains: needle, mode: "insensitive" },
			conversation: {
				userId,
				archivedAt: null,
			},
		},
		orderBy: { createdAt: "desc" },
		take: Math.min(Math.max(limit, 1), 60),
		select: {
			id: true,
			role: true,
			content: true,
			createdAt: true,
			conversation: {
				select: { id: true, title: true },
			},
		},
	});
}

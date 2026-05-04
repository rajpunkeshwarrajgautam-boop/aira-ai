import { z } from "zod";
import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";

const CitationSchema = z.object({
	index: z.number().int().positive(),
	url: z.string().min(1),
	title: z.string(),
	publishedDate: z.string().nullable(),
	rankingScore: z.number(),
	excerpt: z.string().optional(),
	sourceQuality: z.string().optional(),
});

export type PublicCitation = z.infer<typeof CitationSchema>;

const PublicShareSchema = z.object({
	query: z.string(),
	assistantAnswer: z.string(),
	citations: z.array(CitationSchema),
	createdAt: z.date(),
});

function parseCitations(raw: unknown): readonly PublicCitation[] {
	if (!raw) return [];
	if (!Array.isArray(raw)) return [];

	const out: PublicCitation[] = [];
	for (const item of raw) {
		const parsed = CitationSchema.safeParse(item);
		if (!parsed.success) continue;
		out.push(parsed.data);
	}
	return out;
}

export function generatePublicShareToken(): string {
	// base64url is URL-safe without additional encoding.
	return crypto.randomBytes(24).toString("base64url");
}

export function buildShareUrl(token: string, baseUrl: string): string {
	const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	return `${b}/share/${encodeURIComponent(token)}`;
}

export async function ensurePublicShareTokenForResearchHistory(params: {
	readonly userId: string;
	readonly researchHistoryId: string;
}): Promise<{ readonly token: string }> {
	const row = await prisma.researchHistory.findFirst({
		where: { id: params.researchHistoryId, userId: params.userId },
		select: { id: true, publicShareToken: true },
	});
	if (!row) {
		throw new Error("RESEARCH_NOT_FOUND");
	}

	if (row.publicShareToken) {
		return { token: row.publicShareToken };
	}

	const token = generatePublicShareToken();
	await prisma.researchHistory.update({
		where: { id: row.id },
		data: { publicShareToken: token },
	});
	return { token };
}

export async function ensurePublicShareTokenForResearchByConversationAndMessage(params: {
	readonly userId: string;
	readonly conversationId: string;
	readonly messageId: string;
}): Promise<{ readonly token: string }> {
	const row = await prisma.researchHistory.findFirst({
		where: {
			userId: params.userId,
			conversationId: params.conversationId,
			messageId: params.messageId,
		},
		select: { id: true, publicShareToken: true },
	});
	if (!row) {
		throw new Error("RESEARCH_NOT_FOUND");
	}

	if (row.publicShareToken) {
		return { token: row.publicShareToken };
	}

	const token = generatePublicShareToken();
	await prisma.researchHistory.update({
		where: { id: row.id },
		data: { publicShareToken: token },
	});
	return { token };
}

export async function getPublicResearchShareByToken(token: string): Promise<{
	readonly token: string;
	readonly query: string;
	readonly conversationTitle?: string;
	readonly assistantAnswer: string;
	readonly citations: readonly PublicCitation[];
	readonly createdAt: Date;
} | null> {
	if (!token?.trim()) return null;

	const row = await prisma.researchHistory.findFirst({
		where: { publicShareToken: token },
		select: {
			query: true,
			conversation: { select: { title: true } },
			assistantAnswer: true,
			citations: true,
			createdAt: true,
		},
	});

	if (!row) return null;

	const parsed = PublicShareSchema.safeParse({
		query: row.query,
		assistantAnswer: row.assistantAnswer,
		citations: parseCitations(row.citations),
		createdAt: row.createdAt,
	});
	if (!parsed.success) return null;

	return {
		token,
		query: parsed.data.query,
		conversationTitle: row.conversation?.title,
		assistantAnswer: parsed.data.assistantAnswer,
		citations: parsed.data.citations,
		createdAt: parsed.data.createdAt,
	};
}


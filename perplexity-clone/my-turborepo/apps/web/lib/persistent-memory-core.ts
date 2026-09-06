import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { UserMemoryKind } from "@/generated/prisma/enums";

const MAX_RECALL_CANDIDATES = 120;
const MAX_RECALLED_MEMORIES = 10;

export interface UserMemoryDto {
	readonly id: string;
	readonly memoryKey: string;
	readonly kind: UserMemoryKind;
	readonly content: string;
	readonly keywords: readonly string[];
	readonly importance: number;
	readonly confidence: number;
	readonly pinned: boolean;
	readonly lastRecalledAt: Date | null;
	readonly recallCount: number;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}._-]+/gu, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 2)
		.slice(0, 40);
}

function looksSensitive(content: string): boolean {
	const normalized = content.toLowerCase();
	if (
		/\b(password|passcode|pin code|one[- ]?time password|otp|api key|access token|refresh token|private key|client secret|cvv|credit card|debit card|bank account|auth token|bearer token)\b/i.test(
			normalized,
		)
	) {
		return true;
	}
	return /(?:-----begin [a-z ]*private key-----|\bsk-[a-z0-9_-]{12,}|\bnvapi-[a-z0-9_-]{12,}|\bgh[pousr]_[a-z0-9]{20,})/i.test(
		content,
	);
}

/**
 * Compatibility entry point for existing conversation-persistence callers.
 *
 * Ordinary chat is not authorization to mutate durable user memories. Under
 * confirmation-only policy this hook performs no extraction, model request,
 * database read/write, or conversation-summary update. It intentionally returns
 * zero operations even for chat text such as "remember this" or "forget that".
 *
 * Save/pin/delete actions remain available through the explicit manual controls
 * below. Their API callers must authenticate the request and derive userId from
 * the session; a model-produced key or "confirmed" flag is never authorization.
 *
 * A future proposal UI must keep candidates non-durable until the user confirms
 * the exact content/action. Do not restore automatic writes in this hook.
 */
export function refreshPersistentMemory(args: {
	readonly userId: string;
	readonly conversationId: string;
	readonly userMessageId: string;
	readonly query: string;
	readonly answer: string;
}): Promise<{ readonly upserts: number; readonly deletes: number }> {
	void args;
	return Promise.resolve({ upserts: 0, deletes: 0 });
}

function scoreMemory(
	memory: Pick<UserMemoryDto, "memoryKey" | "content" | "keywords" | "importance" | "confidence" | "pinned" | "updatedAt">,
	queryTokens: readonly string[],
	showAll: boolean,
): number {
	const keyTokens = new Set(tokenize(memory.memoryKey));
	const contentTokens = new Set(tokenize(memory.content));
	const keywordTokens = new Set(memory.keywords.flatMap(tokenize));
	let overlap = 0;
	for (const token of queryTokens) {
		if (contentTokens.has(token)) overlap += 2.2;
		if (keywordTokens.has(token)) overlap += 2.8;
		if (keyTokens.has(token)) overlap += 1.6;
	}

	const ageDays = Math.max(0, Date.now() - memory.updatedAt.getTime()) / 86_400_000;
	const recency = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.6 : ageDays <= 180 ? 0.2 : 0;
	const base = memory.importance * 0.55 + memory.confidence * 0.8 + recency + (memory.pinned ? 4 : 0);
	return (showAll ? 4 : 0) + overlap + base;
}

export async function getRelevantPersistentMemories(
	userId: string,
	query: string,
	limit = 8,
): Promise<readonly string[]> {
	const candidates = await prisma.userMemory.findMany({
		where: { userId },
		orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
		take: MAX_RECALL_CANDIDATES,
		select: {
			id: true,
			memoryKey: true,
			kind: true,
			content: true,
			keywords: true,
			importance: true,
			confidence: true,
			pinned: true,
			lastRecalledAt: true,
			recallCount: true,
			createdAt: true,
			updatedAt: true,
		},
	});
	if (candidates.length === 0) return [];

	const showAll = /\b(what do you remember|what do you know about me|remember about me|my memories|my preferences|my profile)\b/i.test(
		query,
	);
	const queryTokens = tokenize(query);
	const ranked = candidates
		.map((memory) => ({ memory, score: scoreMemory(memory, queryTokens, showAll) }))
		.filter(({ memory, score }) => showAll || memory.pinned || score >= 3.8)
		.sort((a, b) => b.score - a.score || b.memory.updatedAt.getTime() - a.memory.updatedAt.getTime())
		.slice(0, Math.min(Math.max(limit, 1), MAX_RECALLED_MEMORIES));

	if (ranked.length === 0) return [];
	const ids = ranked.map(({ memory }) => memory.id);
	void prisma.userMemory
		.updateMany({
			where: { id: { in: ids }, userId },
			data: { recallCount: { increment: 1 }, lastRecalledAt: new Date() },
		})
		.catch(() => undefined);

	return ranked.map(
		({ memory }) => `${memory.kind}: ${memory.content}${memory.pinned ? " (pinned)" : ""}`,
	);
}

export async function listUserMemories(userId: string, limit = 100): Promise<readonly UserMemoryDto[]> {
	return prisma.userMemory.findMany({
		where: { userId },
		orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
		take: Math.min(Math.max(limit, 1), 200),
		select: {
			id: true,
			memoryKey: true,
			kind: true,
			content: true,
			keywords: true,
			importance: true,
			confidence: true,
			pinned: true,
			lastRecalledAt: true,
			recallCount: true,
			createdAt: true,
			updatedAt: true,
		},
	});
}

export async function createManualMemory(args: {
	readonly userId: string;
	readonly content: string;
	readonly kind?: UserMemoryKind;
	readonly pinned?: boolean;
}): Promise<UserMemoryDto> {
	const content = args.content.trim();
	if (!content || looksSensitive(content)) {
		throw new Error("This memory is empty or contains sensitive credential-like information.");
	}
	const digest = createHash("sha256").update(content.toLowerCase()).digest("hex").slice(0, 20);
	const memoryKey = `manual.${digest}`;
	return prisma.userMemory.upsert({
		where: { userId_memoryKey: { userId: args.userId, memoryKey } },
		create: {
			userId: args.userId,
			memoryKey,
			kind: args.kind ?? UserMemoryKind.OTHER,
			content,
			keywords: tokenize(content).slice(0, 10),
			importance: args.pinned ? 5 : 4,
			confidence: 1,
			pinned: args.pinned ?? true,
		},
		update: {
			content,
			kind: args.kind ?? UserMemoryKind.OTHER,
			keywords: tokenize(content).slice(0, 10),
			importance: args.pinned ? 5 : 4,
			confidence: 1,
			pinned: args.pinned ?? true,
		},
		select: {
			id: true,
			memoryKey: true,
			kind: true,
			content: true,
			keywords: true,
			importance: true,
			confidence: true,
			pinned: true,
			lastRecalledAt: true,
			recallCount: true,
			createdAt: true,
			updatedAt: true,
		},
	});
}

export async function setUserMemoryPinned(userId: string, id: string, pinned: boolean): Promise<boolean> {
	const updated = await prisma.userMemory.updateMany({
		where: { id, userId },
		data: { pinned },
	});
	return updated.count === 1;
}

export async function deleteUserMemory(userId: string, id: string): Promise<boolean> {
	const deleted = await prisma.userMemory.deleteMany({ where: { id, userId } });
	return deleted.count === 1;
}

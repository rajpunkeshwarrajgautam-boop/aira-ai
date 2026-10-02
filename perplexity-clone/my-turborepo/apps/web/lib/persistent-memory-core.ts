import { UserMemoryKind } from "@/generated/prisma/enums";
import { manualMemoryKeyForContent } from "@/lib/manual-memory-key";
import { prisma } from "@/lib/prisma";

import { hasMemoryTopicOverlap, isMemoryInventoryQuery, memoryMatchesRequestedSubject, memoryQueryTokens } from "./memory-relevance";

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
		/\b(password|passcode|pin code|one[- ]?time password|otp|api key|access token|refresh token|private key|client secret|cvv|credit card|debit card|bank account|auth token|bearer token|ssn|social security number|driver'?s license|passport number|aadhaar)\b/i.test(
			normalized,
		)
	) {
		return true;
	}
	// Detect card numbers or SSN-like patterns
	if (/\b\d{3}-\d{2}-\d{4}\b/.test(content) || /\b(?:\d{4}[ -]?){3}\d{4}\b/.test(content)) {
		return true;
	}
	// Never store minor status, self-harm, or suicide markers
	if (
		/\b(?:i am|i'm)\s+(?:under 18|[1-9]|1[0-7])\s*(?:years? old)?\b/i.test(normalized) ||
		/\b(?:minor|suicide|self[- ]?harm)\b/i.test(normalized)
	) {
		return true;
	}
	return /(?:-----begin [a-z ]*private key-----|\bsk-[a-z0-9_-]{12,}|\bnvapi-[a-z0-9_-]{12,}|\bgh[pousr]_[a-z0-9]{20,})/i.test(
		content,
	);
}

const GREETING_PATTERNS: ReadonlyArray<RegExp> = [
	/^(hi|hello|hey|howdy)(\s+there)?[!.,\s]*$/i,
	/^(thanks|thank you|thx|ty)[!.,\s]*$/i,
	/^(bye|goodbye|see you|cya)[!.,\s]*$/i,
	/^good (morning|afternoon|evening|night)[!.,\s]*$/i,
	/^(gm|gn)\b[!.,\s]*$/i,
	/^(ok|okay|k|cool|nice|great)[!.,\s]*$/i,
	/^how are you\??[!.,\s]*$/i,
	/^what'?s up\??[!.,\s]*$/i,
	/^sup\??[!.,\s]*$/i,
];

function isGreetingQuery(raw: string): boolean {
	const t = raw.trim().replace(/\s+/g, " ");
	if (t.length === 0 || t.length > 80 || raw.includes("\n")) return false;
	return GREETING_PATTERNS.some((r) => r.test(t));
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

	const showAll = isMemoryInventoryQuery(query);
	const queryTokens = memoryQueryTokens(query);
	if ((queryTokens.length === 0 || isGreetingQuery(query)) && !showAll) return [];
	const ranked = candidates
		.map((memory) => ({ memory, score: scoreMemory(memory, queryTokens, showAll) }))
		.filter(({ memory, score }) => showAll || (score >= 3.8 &&
			memoryMatchesRequestedSubject(memory.content, query) &&
			hasMemoryTopicOverlap(memory.content, memory.keywords, query)))
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

const USER_MEMORY_SELECT = {
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
} as const;

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
	const memoryKey = manualMemoryKeyForContent(content);
	const data = {
		content,
		kind: args.kind ?? UserMemoryKind.OTHER,
		keywords: tokenize(content).slice(0, 10),
		importance: args.pinned ? 5 : 4,
		confidence: 1,
		pinned: args.pinned ?? true,
	};

	return prisma.$transaction(async (tx) => {
		const existing = await tx.userMemory.findUnique({
			where: { userId_memoryKey: { userId: args.userId, memoryKey } },
			select: { id: true },
		});
		if (existing) {
			return tx.userMemory.update({
				where: { id: existing.id },
				data,
				select: USER_MEMORY_SELECT,
			});
		}

		if (memoryKey.startsWith("manual.slot.")) {
			const legacy = await tx.userMemory.findMany({
				where: { userId: args.userId, memoryKey: { startsWith: "manual." } },
				orderBy: { updatedAt: "desc" },
				take: 120,
				select: { id: true, memoryKey: true, content: true },
			});
			const sameSlot = legacy.find(
				(memory) =>
					memory.memoryKey !== memoryKey &&
					manualMemoryKeyForContent(memory.content) === memoryKey,
			);
			if (sameSlot) {
				return tx.userMemory.update({
					where: { id: sameSlot.id },
					data: { ...data, memoryKey },
					select: USER_MEMORY_SELECT,
				});
			}
		}

		return tx.userMemory.create({
			data: {
				userId: args.userId,
				memoryKey,
				...data,
			},
			select: USER_MEMORY_SELECT,
		});
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

import { createHash } from "node:crypto";

import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { prisma } from "@/lib/prisma";
import { UserMemoryKind } from "@/generated/prisma/enums";
import { ProviderRouter } from "@services/providers/provider-router";

const MAX_MEMORY_CANDIDATES = 8;
const MAX_RECALL_CANDIDATES = 120;
const MAX_RECALLED_MEMORIES = 10;

const MemoryOperationSchema = z.object({
	operation: z.enum(["UPSERT", "DELETE"]),
	key: z.string().trim().min(3).max(120),
	kind: z.enum([
		"PROFILE",
		"PREFERENCE",
		"GOAL",
		"PROJECT",
		"DECISION",
		"CONSTRAINT",
		"RELATIONSHIP",
		"OTHER",
	]),
	content: z.string().trim().max(600).default(""),
	keywords: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
	importance: z.number().int().min(1).max(5).default(3),
	confidence: z.number().min(0).max(1).default(1),
});

const MemoryExtractionSchema = z.object({
	summary: z.string().trim().max(1800),
	memories: z.array(MemoryOperationSchema).max(MAX_MEMORY_CANDIDATES),
});

type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

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

function canonicalMemoryKey(value: string, fallbackContent: string): string {
	const cleaned = value
		.toLowerCase()
		.normalize("NFKC")
		.replace(/[^a-z0-9._-]+/g, ".")
		.replace(/\.{2,}/g, ".")
		.replace(/^\.|\.$/g, "")
		.slice(0, 120);
	if (cleaned.length >= 3) return cleaned;
	const digest = createHash("sha256").update(fallbackContent).digest("hex").slice(0, 20);
	return `memory.${digest}`;
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

function extractJsonObject(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Memory curator returned no JSON object.");
	return trimmed.slice(start, end + 1);
}

function parseMemoryExtraction(raw: string): z.infer<typeof MemoryExtractionSchema> {
	return MemoryExtractionSchema.parse(JSON.parse(extractJsonObject(raw)));
}

async function collectRouterText(
	router: ProviderRouter,
	messages: ChatCompletionMessageParam[],
	maxCompletionTokens = 1600,
): Promise<string> {
	let output = "";
	for await (const delta of router.streamChat(messages, {
		temperature: 0,
		maxCompletionTokens,
	})) {
		output += delta;
	}
	return output;
}

const MEMORY_CURATOR_SYSTEM_PROMPT = `You are AIRA's private memory curator. Return STRICT JSON only.

Your job is to maintain useful, durable user memory and a compact rolling conversation summary.

Memory rules:
- Store only stable or repeatedly useful information about the user: profile facts, preferences, goals, ongoing projects, decisions, constraints, and durable relationships.
- Treat an explicit user request such as "remember this", "remember that", "from now on", or "always" as strong evidence to store a memory when safe.
- Treat "forget", "delete that memory", "don't remember", or a correction of an earlier fact as an instruction to delete or replace the matching memory.
- Use a stable canonical key such as preference.answer_style, profile.location, goal.business.revenue, project.aira.status, constraint.budget.gpu. Reuse an existing key when correcting the same fact.
- Never store assistant guesses, web content, source text, or claims that were not stated or clearly confirmed by the user.
- Never store passwords, passcodes, API keys, auth/session tokens, OTPs, private keys, payment-card data, bank account details, or other credentials/secrets.
- Do not infer or persist highly sensitive attributes (medical diagnoses, sexual life, religion, political beliefs, precise financial account data) unless the user explicitly asks AIRA to remember that specific information.
- Do not store trivial one-off requests, temporary search queries, greetings, or information that will not help future conversations.
- Keep each memory concise, self-contained, and written as a neutral fact about the user.
- importance: 5 = central long-term preference/identity/project constraint, 3 = useful recurring context, 1 = weak/temporary.
- confidence reflects how explicitly the user stated or confirmed the memory.

Conversation summary rules:
- Update the existing summary using the latest user/assistant turn.
- Preserve active goals, decisions, unresolved tasks, named projects/entities, and context needed to continue the thread after older messages fall out of the prompt window.
- Remove superseded information when the user corrects it.
- Keep the summary under 1800 characters and never include credentials or secret values.

Output rules:
- Return one JSON object and nothing else.
- Do not include markdown fences, prose, prefaces, explanations, analysis, or visible thinking.
- The first non-whitespace character must be { and the last non-whitespace character must be }.

Return exactly:
{
  "summary": "compact updated summary",
  "memories": [
    {
      "operation": "UPSERT" | "DELETE",
      "key": "canonical.key",
      "kind": "PROFILE" | "PREFERENCE" | "GOAL" | "PROJECT" | "DECISION" | "CONSTRAINT" | "RELATIONSHIP" | "OTHER",
      "content": "concise memory; empty for DELETE",
      "keywords": ["search", "terms"],
      "importance": 1,
      "confidence": 0.0
    }
  ]
}`;

async function curateLatestTurn(args: {
	readonly userId: string;
	readonly currentSummary: string;
	readonly query: string;
	readonly answer: string;
}): Promise<z.infer<typeof MemoryExtractionSchema>> {
	const existing = await prisma.userMemory.findMany({
		where: { userId: args.userId },
		orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
		take: 40,
		select: { memoryKey: true, kind: true, content: true },
	});

	const existingText = existing.length
		? existing.map((m) => `- ${m.memoryKey} [${m.kind}]: ${m.content}`).join("\n")
		: "(none)";

	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: MEMORY_CURATOR_SYSTEM_PROMPT },
		{
			role: "user",
			content:
				`Existing conversation summary:\n${args.currentSummary || "(none)"}\n\n` +
				`Existing durable memories (keys are authoritative for corrections/deletes):\n${existingText}\n\n` +
				`Latest user message:\n${args.query.slice(0, 6000)}\n\n` +
				`Latest assistant answer (context only; never turn assistant claims into user facts):\n${args.answer.slice(0, 8000)}`,
		},
	];

	const router = await ProviderRouter.createDefault();
	const raw = await collectRouterText(router, messages, 1600);
	try {
		return parseMemoryExtraction(raw);
	} catch (firstError) {
		console.warn(
			"[AIRA memory] Curator output was invalid; retrying once:",
			firstError instanceof Error ? firstError.message : String(firstError),
		);
		const retryMessages: ChatCompletionMessageParam[] = [
			...messages,
			{
				role: "user",
				content:
					"Your previous response was invalid. Retry the same memory-curation task. Return ONLY the required JSON object, with no markdown, prose, analysis, or thinking. Ensure the JSON parses exactly.",
			},
		];
		const retryRaw = await collectRouterText(router, retryMessages, 2400);
		return parseMemoryExtraction(retryRaw);
	}
}

export async function refreshPersistentMemory(args: {
	readonly userId: string;
	readonly conversationId: string;
	readonly userMessageId: string;
	readonly query: string;
	readonly answer: string;
}): Promise<{ readonly upserts: number; readonly deletes: number }> {
	const conversation = await prisma.conversation.findFirst({
		where: { id: args.conversationId, userId: args.userId },
		select: { summary: true, summaryMessageCount: true },
	});
	if (!conversation) return { upserts: 0, deletes: 0 };

	const curated = await curateLatestTurn({
		userId: args.userId,
		currentSummary: conversation.summary ?? "",
		query: args.query,
		answer: args.answer,
	});

	const safeSummary = looksSensitive(curated.summary) ? conversation.summary ?? "" : curated.summary;
	let upserts = 0;
	let deletes = 0;

	await prisma.$transaction(async (tx) => {
		await tx.conversation.update({
			where: { id: args.conversationId },
			data: {
				summary: safeSummary || null,
				summaryUpdatedAt: new Date(),
				summaryMessageCount: conversation.summaryMessageCount + 2,
			},
		});

		for (const rawOperation of curated.memories) {
			const operation: MemoryOperation = rawOperation;
			const memoryKey = canonicalMemoryKey(operation.key, operation.content || operation.key);

			if (operation.operation === "DELETE") {
				const removed = await tx.userMemory.deleteMany({
					where: { userId: args.userId, memoryKey },
				});
				deletes += removed.count;
				continue;
			}

			if (!operation.content || looksSensitive(operation.content)) continue;
			const keywords = Array.from(
				new Set(operation.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
			).slice(0, 10);

			await tx.userMemory.upsert({
				where: { userId_memoryKey: { userId: args.userId, memoryKey } },
				create: {
					userId: args.userId,
					memoryKey,
					kind: operation.kind as UserMemoryKind,
					content: operation.content,
					keywords,
					importance: operation.importance,
					confidence: operation.confidence,
					sourceConversationId: args.conversationId,
					sourceMessageId: args.userMessageId,
				},
				update: {
					kind: operation.kind as UserMemoryKind,
					content: operation.content,
					keywords,
					importance: operation.importance,
					confidence: operation.confidence,
					sourceConversationId: args.conversationId,
					sourceMessageId: args.userMessageId,
				},
			});
			upserts += 1;
		}
	});

	return { upserts, deletes };
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

import { createHash } from "node:crypto";

import OpenAI from "openai";

import {
	EmbeddingCircuitOpenError,
	embeddingCircuitStatus,
	noteEmbeddingFailure,
	resetEmbeddingCircuit,
} from "@/lib/embedding-circuit";
import { prisma } from "@/lib/prisma";

export const AIRA_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function embeddingModel(): string {
	return process.env.AIRA_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function embeddingApiKey(): string | undefined {
	return process.env.AIRA_EMBEDDING_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
}

export function semanticMemoryEnabled(): boolean {
	return process.env.SEMANTIC_MEMORY_ENABLED === "true";
}

export function semanticMemoryConfigured(): boolean {
	return semanticMemoryEnabled() && Boolean(embeddingApiKey());
}

let embeddingClient: OpenAI | undefined;
let embeddingClientKey = "";

function getEmbeddingClient(): OpenAI {
	const apiKey = embeddingApiKey();
	if (!apiKey) throw new Error("Semantic memory is enabled but no embedding API key is configured.");
	const baseURL = process.env.AIRA_EMBEDDING_BASE_URL?.trim() || undefined;
	const cacheKey = `${baseURL ?? "default"}|${apiKey}`;
	if (!embeddingClient || embeddingClientKey !== cacheKey) {
		embeddingClient = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
		embeddingClientKey = cacheKey;
	}
	return embeddingClient;
}

function vectorLiteral(values: readonly number[]): string {
	if (values.length !== AIRA_EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Embedding dimension mismatch: expected ${AIRA_EMBEDDING_DIMENSIONS}, received ${values.length}.`,
		);
	}
	for (const value of values) {
		if (!Number.isFinite(value)) throw new Error("Embedding contains a non-finite value.");
	}
	return `[${values.join(",")}]`;
}

export async function embedText(text: string): Promise<readonly number[]> {
	if (!semanticMemoryConfigured()) throw new Error("Semantic memory is not configured.");
	const input = text.trim();
	if (!input) throw new Error("Cannot embed empty text.");
	const breaker = embeddingCircuitStatus();
	if (breaker.state === "open") {
		throw new EmbeddingCircuitOpenError(breaker.kind ?? "transient", breaker.retryAfterMs);
	}

	let response;
	try {
		response = await getEmbeddingClient().embeddings.create({
			model: embeddingModel(),
			input: input.slice(0, 12_000),
			encoding_format: "float",
		});
	} catch (error) {
		noteEmbeddingFailure(error);
		throw error;
	}

	const embedding = response.data[0]?.embedding;
	if (!embedding) throw new Error("Embedding provider returned no vector.");
	vectorLiteral(embedding);
	resetEmbeddingCircuit();
	return embedding;
}

export async function upsertUserMemoryEmbedding(args: {
	readonly memoryId: string;
	readonly userId: string;
	readonly content: string;
}): Promise<void> {
	if (!semanticMemoryConfigured()) return;
	const embedding = await embedText(args.content);
	const literal = vectorLiteral(embedding);
	const contentHash = createHash("sha256").update(args.content).digest("hex");
	const model = embeddingModel();

	await prisma.$executeRaw`
		insert into public."UserMemoryEmbedding"
			("memoryId", "userId", model, dimensions, embedding, "contentHash", "updatedAt")
		values
			(${args.memoryId}, ${args.userId}, ${model}, ${AIRA_EMBEDDING_DIMENSIONS}, ${literal}::extensions.vector, ${contentHash}, now())
		on conflict ("memoryId") do update set
			"userId" = excluded."userId",
			model = excluded.model,
			dimensions = excluded.dimensions,
			embedding = excluded.embedding,
			"contentHash" = excluded."contentHash",
			"updatedAt" = now()
	`;
}

export async function getSemanticMemoryScores(
	userId: string,
	query: string,
	limit = 32,
): Promise<ReadonlyMap<string, number>> {
	if (!semanticMemoryConfigured() || !query.trim()) return new Map();
	const embedding = await embedText(query);
	const literal = vectorLiteral(embedding);
	const take = Math.min(Math.max(limit, 1), 64);
	const rows = await prisma.$queryRaw<Array<{ memoryId: string; similarity: number }>>`
		select
			"memoryId",
			(1 - (embedding <=> ${literal}::extensions.vector))::double precision as similarity
		from public."UserMemoryEmbedding"
		where "userId" = ${userId}
		order by embedding <=> ${literal}::extensions.vector
		limit ${take}
	`;
	return new Map(
		rows
			.filter((row) => Number.isFinite(row.similarity))
			.map((row) => [row.memoryId, Math.max(-1, Math.min(1, row.similarity))]),
	);
}

export {
	EmbeddingCircuitOpenError,
	embeddingCircuitStatus,
	resetEmbeddingCircuit,
	type EmbeddingFailureKind,
} from "@/lib/embedding-circuit";

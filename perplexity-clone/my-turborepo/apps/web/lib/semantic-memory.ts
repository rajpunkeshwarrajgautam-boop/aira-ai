import { createHash } from "node:crypto";

import OpenAI from "openai";

import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";
import {
	formatSemanticEmbeddingInput,
	resolveSemanticEmbeddingRoute,
	SEMANTIC_EMBEDDING_DIMENSIONS,
	semanticEmbeddingTierForBillingPlan,
	semanticMemoryEnabled,
	type SemanticEmbeddingRoute,
	type SemanticEmbeddingWorkload,
} from "@/lib/semantic-embedding-policy";

export { SEMANTIC_EMBEDDING_DIMENSIONS, semanticMemoryEnabled } from "@/lib/semantic-embedding-policy";
export type { SemanticEmbeddingRoute } from "@/lib/semantic-embedding-policy";

export interface SemanticEmbeddingResult {
	readonly vector: readonly number[];
	readonly route: SemanticEmbeddingRoute;
}

/** Compatibility helper for code/tests that only need to know whether any route exists. */
export function semanticMemoryConfigured(): boolean {
	return (
		resolveSemanticEmbeddingRoute("free") !== null ||
		resolveSemanticEmbeddingRoute("pro") !== null
	);
}

export async function resolveSemanticEmbeddingRouteForUser(
	userId: string,
): Promise<SemanticEmbeddingRoute | null> {
	if (!semanticMemoryEnabled()) return null;
	const entitlements = await getEffectiveEntitlements(userId);
	const tier = semanticEmbeddingTierForBillingPlan(entitlements.billingPlan);
	const route = resolveSemanticEmbeddingRoute(tier);
	if (route && process.env.NODE_ENV === "production") {
		console.info(
			"[AIRA semantic embedding] route selected",
			JSON.stringify({
				tier: route.tier,
				providerId: route.providerId,
				model: route.model,
				dimensions: route.dimensions,
			}),
		);
	}
	return route;
}

const embeddingClients = new Map<string, OpenAI>();

function clientForRoute(route: SemanticEmbeddingRoute): OpenAI {
	const keyHash = createHash("sha256").update(route.apiKey ?? "no-key").digest("hex").slice(0, 16);
	const cacheKey = `${route.providerId}|${route.baseURL ?? "default"}|${keyHash}`;
	const existing = embeddingClients.get(cacheKey);
	if (existing) return existing;
	const client = new OpenAI({
		apiKey: route.apiKey ?? "aira-local-no-key-required",
		...(route.baseURL ? { baseURL: route.baseURL } : {}),
	});
	embeddingClients.set(cacheKey, client);
	return client;
}

export function semanticEmbeddingVectorLiteral(values: readonly number[]): string {
	if (values.length !== SEMANTIC_EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Embedding dimension mismatch: expected ${SEMANTIC_EMBEDDING_DIMENSIONS}, received ${values.length}.`,
		);
	}
	for (const value of values) {
		if (!Number.isFinite(value)) throw new Error("Embedding contains a non-finite value.");
	}
	return `[${values.join(",")}]`;
}

export async function embedTextWithRoute(
	route: SemanticEmbeddingRoute,
	text: string,
	workload: SemanticEmbeddingWorkload,
): Promise<SemanticEmbeddingResult> {
	const input = formatSemanticEmbeddingInput(route, text, workload).slice(0, 12_000);
	if (!input) throw new Error("Cannot embed empty text.");
	const response = await clientForRoute(route).embeddings.create({
		model: route.model,
		input,
		encoding_format: "float",
		...(route.providerId === "openai" ? { dimensions: route.dimensions } : {}),
	});
	const vector = response.data[0]?.embedding;
	if (!vector) throw new Error("Embedding provider returned no vector.");
	semanticEmbeddingVectorLiteral(vector);
	return { vector, route };
}

export async function embedTextForUser(
	userId: string,
	text: string,
	workload: SemanticEmbeddingWorkload,
): Promise<SemanticEmbeddingResult | null> {
	const route = await resolveSemanticEmbeddingRouteForUser(userId);
	if (!route) return null;
	return embedTextWithRoute(route, text, workload);
}

export async function upsertUserMemoryEmbedding(args: {
	readonly memoryId: string;
	readonly userId: string;
	readonly content: string;
	readonly route?: SemanticEmbeddingRoute;
}): Promise<void> {
	const route = args.route ?? (await resolveSemanticEmbeddingRouteForUser(args.userId));
	if (!route) return;
	const { vector } = await embedTextWithRoute(route, args.content, "document");
	const literal = semanticEmbeddingVectorLiteral(vector);
	const contentHash = createHash("sha256").update(args.content).digest("hex");

	await prisma.$executeRaw`
		insert into public."UserMemorySemanticEmbedding"
			("memoryId", "userId", tier, provider, model, dimensions, embedding, "contentHash", "updatedAt")
		values
			(${args.memoryId}, ${args.userId}, ${route.tier}, ${route.providerId}, ${route.model}, ${route.dimensions}, ${literal}::extensions.vector, ${contentHash}, now())
		on conflict ("memoryId", tier) do update set
			"userId" = excluded."userId",
			provider = excluded.provider,
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
	route?: SemanticEmbeddingRoute,
): Promise<ReadonlyMap<string, number>> {
	if (!query.trim()) return new Map();
	const selectedRoute = route ?? (await resolveSemanticEmbeddingRouteForUser(userId));
	if (!selectedRoute) return new Map();
	const { vector } = await embedTextWithRoute(selectedRoute, query, "query");
	const literal = semanticEmbeddingVectorLiteral(vector);
	const take = Math.min(Math.max(limit, 1), 64);
	const rows = await prisma.$queryRaw<Array<{ memoryId: string; similarity: number }>>`
		select
			"memoryId",
			(1 - (embedding <=> ${literal}::extensions.vector))::double precision as similarity
		from public."UserMemorySemanticEmbedding"
		where "userId" = ${userId}
			and tier = ${selectedRoute.tier}
			and provider = ${selectedRoute.providerId}
			and model = ${selectedRoute.model}
		order by embedding <=> ${literal}::extensions.vector
		limit ${take}
	`;
	return new Map(
		rows
			.filter((row) => Number.isFinite(row.similarity))
			.map((row) => [row.memoryId, Math.max(-1, Math.min(1, row.similarity))]),
	);
}

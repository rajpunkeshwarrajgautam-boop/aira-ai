import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
	embedTextWithRoute,
	resolveSemanticEmbeddingRouteForUser,
	semanticEmbeddingVectorLiteral,
	type SemanticEmbeddingRoute,
} from "@/lib/semantic-memory";

export type KnowledgeAssetStatus = "UPLOADING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export interface KnowledgeChunkInput {
	readonly ordinal: number;
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
}

type KnowledgeAssetRow = {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly sizeBytes: bigint;
	readonly status: string;
	readonly errorMessage: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
};

type PreparedChunk = {
	readonly id: string;
	readonly ordinal: number;
	readonly content: string;
	readonly metadata: string;
	readonly semantic:
		| {
				readonly literal: string;
				readonly contentHash: string;
				readonly route: SemanticEmbeddingRoute;
		  }
		| null;
};

export async function createKnowledgeAsset(args: {
	readonly id?: string;
	readonly userId: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
	readonly sha256: string;
	readonly storageKey: string;
	readonly metadata?: Record<string, unknown>;
}): Promise<string> {
	const id = args.id ?? randomUUID();
	const metadata = JSON.stringify(args.metadata ?? {});
	await prisma.$executeRaw`
		insert into public."KnowledgeAsset"
			(id, "userId", filename, "mimeType", "sizeBytes", sha256, "storageKey", status, metadata)
		values
			(${id}, ${args.userId}, ${args.filename}, ${args.mimeType}, ${args.sizeBytes}, ${args.sha256}, ${args.storageKey}, 'UPLOADING', ${metadata}::jsonb)
	`;
	return id;
}

export async function listKnowledgeAssets(
	userId: string,
	limit = 50,
): Promise<readonly KnowledgeAssetRow[]> {
	const take = Math.min(Math.max(limit, 1), 100);
	return prisma.$queryRaw<KnowledgeAssetRow[]>`
		select id, filename, "mimeType", "sizeBytes", status, "errorMessage", "createdAt", "updatedAt"
		from public."KnowledgeAsset"
		where "userId" = ${userId}
		order by "createdAt" desc
		limit ${take}
	`;
}

export async function updateKnowledgeAssetStatus(args: {
	readonly assetId: string;
	readonly userId: string;
	readonly status: KnowledgeAssetStatus;
	readonly errorMessage?: string | null;
}): Promise<void> {
	const changed = await prisma.$executeRaw`
		update public."KnowledgeAsset"
		set status = ${args.status},
			"errorMessage" = ${args.errorMessage ?? null},
			"updatedAt" = now()
		where id = ${args.assetId} and "userId" = ${args.userId}
	`;
	if (changed !== 1) throw new Error("Knowledge asset was not found for this user.");
}

async function embeddingRouteOrNull(userId: string): Promise<SemanticEmbeddingRoute | null> {
	try {
		return await resolveSemanticEmbeddingRouteForUser(userId);
	} catch (error) {
		console.warn(
			"[AIRA semantic embedding] Knowledge entitlement/configuration resolution failed; storing lexical chunks only:",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}

async function prepareChunkRows(
	userId: string,
	chunks: readonly KnowledgeChunkInput[],
): Promise<readonly PreparedChunk[]> {
	const route = await embeddingRouteOrNull(userId);
	const rows: PreparedChunk[] = [];
	for (const chunk of chunks.slice(0, 256)) {
		const content = chunk.content.trim().slice(0, 12_000);
		if (!content) continue;
		let semantic: PreparedChunk["semantic"] = null;
		if (route) {
			try {
				const { vector } = await embedTextWithRoute(route, content, "document");
				semantic = {
					literal: semanticEmbeddingVectorLiteral(vector),
					contentHash: createHash("sha256").update(content).digest("hex"),
					route,
				};
			} catch (error) {
				console.warn(
					"[AIRA semantic embedding] Knowledge chunk embedding failed; retaining lexical chunk:",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		rows.push({
			id: randomUUID(),
			ordinal: chunk.ordinal,
			content,
			metadata: JSON.stringify(chunk.metadata ?? {}),
			semantic,
		});
	}
	return rows;
}

export async function replaceKnowledgeChunks(args: {
	readonly assetId: string;
	readonly userId: string;
	readonly chunks: readonly KnowledgeChunkInput[];
}): Promise<void> {
	const owner = await prisma.$queryRaw<Array<{ id: string }>>`
		select id from public."KnowledgeAsset"
		where id = ${args.assetId} and "userId" = ${args.userId}
		limit 1
	`;
	if (owner.length !== 1) throw new Error("Knowledge asset ownership check failed.");
	const rows = await prepareChunkRows(args.userId, args.chunks);
	if (rows.length === 0) throw new Error("No usable document chunks were produced.");

	await prisma.$transaction(async (tx) => {
		await tx.$executeRaw`
			delete from public."KnowledgeChunk"
			where "assetId" = ${args.assetId} and "userId" = ${args.userId}
		`;
		for (const row of rows) {
			await tx.$executeRaw`
				insert into public."KnowledgeChunk"
					(id, "assetId", "userId", ordinal, content, metadata)
				values
					(${row.id}, ${args.assetId}, ${args.userId}, ${row.ordinal}, ${row.content}, ${row.metadata}::jsonb)
			`;
			if (row.semantic) {
				const { route, literal, contentHash } = row.semantic;
				await tx.$executeRaw`
					insert into public."KnowledgeChunkSemanticEmbedding"
						("chunkId", "userId", tier, provider, model, dimensions, embedding, "contentHash", "updatedAt")
					values
						(${row.id}, ${args.userId}, ${route.tier}, ${route.providerId}, ${route.model}, ${route.dimensions}, ${literal}::extensions.vector, ${contentHash}, now())
					on conflict ("chunkId", tier) do update set
						"userId" = excluded."userId",
						provider = excluded.provider,
						model = excluded.model,
						dimensions = excluded.dimensions,
						embedding = excluded.embedding,
						"contentHash" = excluded."contentHash",
						"updatedAt" = now()
				`;
			}
		}
	});
}

export async function getRelevantKnowledgeContext(
	userId: string,
	query: string,
	limit = 6,
): Promise<readonly string[]> {
	if (process.env.MULTIMODAL_INGESTION_ENABLED !== "true") return [];
	const route = await embeddingRouteOrNull(userId);
	if (!route) return [];
	let literal: string;
	try {
		const { vector } = await embedTextWithRoute(route, query, "query");
		literal = semanticEmbeddingVectorLiteral(vector);
	} catch (error) {
		console.warn(
			"[AIRA semantic embedding] Knowledge query embedding failed; semantic knowledge unavailable:",
			error instanceof Error ? error.message : String(error),
		);
		return [];
	}
	const take = Math.min(Math.max(limit, 1), 12);
	const rows = await prisma.$queryRaw<
		Array<{ filename: string; ordinal: number; content: string; similarity: number }>
	>`
		select
			a.filename,
			kc.ordinal,
			kc.content,
			(1 - (kse.embedding <=> ${literal}::extensions.vector))::double precision as similarity
		from public."KnowledgeChunkSemanticEmbedding" kse
		join public."KnowledgeChunk" kc on kc.id = kse."chunkId"
		join public."KnowledgeAsset" a on a.id = kc."assetId"
		where kse."userId" = ${userId}
			and kc."userId" = ${userId}
			and a.status = 'READY'
			and kse.tier = ${route.tier}
			and kse.provider = ${route.providerId}
			and kse.model = ${route.model}
		order by kse.embedding <=> ${literal}::extensions.vector
		limit ${take}
	`;
	return rows
		.filter((row) => row.similarity >= 0.55)
		.map(
			(row) =>
				`<aira_untrusted_user_document source=${JSON.stringify(row.filename)} chunk=${row.ordinal}>\n${row.content.slice(0, 2600)}\n</aira_untrusted_user_document>`,
		);
}

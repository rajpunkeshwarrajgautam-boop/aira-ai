import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
	AIRA_EMBEDDING_DIMENSIONS,
	embedText,
	semanticMemoryConfigured,
} from "@/lib/semantic-memory";

export type KnowledgeAssetStatus = "UPLOADING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export interface KnowledgeChunkInput {
	readonly ordinal: number;
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
}

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

export async function listKnowledgeAssets(userId: string, limit = 50): Promise<
	readonly {
		readonly id: string;
		readonly filename: string;
		readonly mimeType: string;
		readonly sizeBytes: bigint;
		readonly status: string;
		readonly errorMessage: string | null;
		readonly createdAt: Date;
		readonly updatedAt: Date;
	}[]
> {
	const take = Math.min(Math.max(limit, 1), 100);
	return prisma.$queryRaw`
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

async function prepareChunkRows(chunks: readonly KnowledgeChunkInput[]): Promise<
	readonly {
		readonly id: string;
		readonly ordinal: number;
		readonly content: string;
		readonly metadata: string;
		readonly embedding: string | null;
		readonly model: string | null;
	}[]
> {
	const model = process.env.AIRA_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
	const rows = [];
	for (const chunk of chunks.slice(0, 256)) {
		const content = chunk.content.trim().slice(0, 12_000);
		if (!content) continue;
		let embedding: string | null = null;
		let usedModel: string | null = null;
		if (semanticMemoryConfigured()) {
			const vector = await embedText(content);
			embedding = `[${vector.join(",")}]`;
			usedModel = model;
		}
		rows.push({
			id: randomUUID(),
			ordinal: chunk.ordinal,
			content,
			metadata: JSON.stringify(chunk.metadata ?? {}),
			embedding,
			model: usedModel,
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
	const rows = await prepareChunkRows(args.chunks);
	if (rows.length === 0) throw new Error("No usable document chunks were produced.");

	await prisma.$transaction(async (tx) => {
		await tx.$executeRaw`
			delete from public."KnowledgeChunk"
			where "assetId" = ${args.assetId} and "userId" = ${args.userId}
		`;
		for (const row of rows) {
			if (row.embedding) {
				await tx.$executeRaw`
					insert into public."KnowledgeChunk"
						(id, "assetId", "userId", ordinal, content, model, dimensions, embedding, metadata)
					values
						(${row.id}, ${args.assetId}, ${args.userId}, ${row.ordinal}, ${row.content}, ${row.model}, ${AIRA_EMBEDDING_DIMENSIONS}, ${row.embedding}::extensions.vector, ${row.metadata}::jsonb)
				`;
			} else {
				await tx.$executeRaw`
					insert into public."KnowledgeChunk"
						(id, "assetId", "userId", ordinal, content, metadata)
					values
						(${row.id}, ${args.assetId}, ${args.userId}, ${row.ordinal}, ${row.content}, ${row.metadata}::jsonb)
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
	if (process.env.MULTIMODAL_INGESTION_ENABLED !== "true" || !semanticMemoryConfigured()) return [];
	const vector = await embedText(query);
	const literal = `[${vector.join(",")}]`;
	const take = Math.min(Math.max(limit, 1), 12);
	const rows = await prisma.$queryRaw<
		Array<{ filename: string; ordinal: number; content: string; similarity: number }>
	>`
		select
			a.filename,
			kc.ordinal,
			kc.content,
			(1 - (kc.embedding <=> ${literal}::extensions.vector))::double precision as similarity
		from public."KnowledgeChunk" kc
		join public."KnowledgeAsset" a on a.id = kc."assetId"
		where kc."userId" = ${userId}
			and a.status = 'READY'
			and kc.embedding is not null
		order by kc.embedding <=> ${literal}::extensions.vector
		limit ${take}
	`;
	return rows
		.filter((row) => row.similarity >= 0.55)
		.map(
			(row) =>
				`<aira_untrusted_user_document source=${JSON.stringify(row.filename)} chunk=${row.ordinal}>\n${row.content.slice(0, 2600)}\n</aira_untrusted_user_document>`,
		);
}

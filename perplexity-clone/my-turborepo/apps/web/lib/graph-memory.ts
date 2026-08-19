import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

export interface GraphEntityInput {
	readonly key: string;
	readonly type: string;
	readonly label: string;
	readonly attributes?: Record<string, unknown>;
	readonly confidence?: number;
}

export interface GraphRelationInput {
	readonly subjectKey: string;
	readonly predicate: string;
	readonly objectKey: string;
	readonly confidence?: number;
}

export interface GraphExtraction {
	readonly entities: readonly GraphEntityInput[];
	readonly relations: readonly GraphRelationInput[];
}

type GraphRow = {
	entityId: string;
	entityType: string;
	label: string;
	attributes: unknown;
	predicate: string | null;
	objectLabel: string | null;
	confidence: number;
	updatedAt: Date;
};

function enabled(): boolean {
	return process.env.GRAPH_MEMORY_ENABLED === "true";
}

function cleanToken(value: string, max = 120): string {
	return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max);
}

function keyToken(value: string): string {
	return cleanToken(value, 160).toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
}

function predicateToken(value: string): string {
	return keyToken(value).replace(/[:.]/g, "-").slice(0, 80);
}

function boundedConfidence(value: number | undefined): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value ?? 1)) : 1;
}

function queryTerms(query: string): string[] {
	return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu) ?? [])].slice(0, 24);
}

/**
 * Persist only already-curated graph extraction. This function does not ask a model to infer
 * facts by itself; callers must separately validate extraction provenance and confidence.
 */
export async function upsertGraphExtraction(args: {
	readonly userId: string;
	readonly sourceMemoryId: string;
	readonly extraction: GraphExtraction;
}): Promise<void> {
	if (!enabled()) return;
	const entities = args.extraction.entities.slice(0, 24);
	const relations = args.extraction.relations.slice(0, 48);
	if (entities.length === 0) return;

	await prisma.$transaction(async (tx) => {
		const entityIds = new Map<string, string>();
		for (const entity of entities) {
			const entityKey = keyToken(entity.key);
			const label = cleanToken(entity.label);
			const entityType = keyToken(entity.type).slice(0, 64) || "other";
			if (!entityKey || !label) continue;
			const id = randomUUID();
			const attributes = JSON.stringify(entity.attributes ?? {});
			const rows = await tx.$queryRaw<Array<{ id: string }>>`
				insert into public."MemoryEntity"
					(id, "userId", "entityKey", "entityType", label, "normalizedLabel", attributes, confidence, "sourceMemoryId", "updatedAt")
				values
					(${id}, ${args.userId}, ${entityKey}, ${entityType}, ${label}, ${label.toLowerCase()}, ${attributes}::jsonb, ${boundedConfidence(entity.confidence)}, ${args.sourceMemoryId}, now())
				on conflict ("userId", "entityKey") do update set
					"entityType" = excluded."entityType",
					label = excluded.label,
					"normalizedLabel" = excluded."normalizedLabel",
					attributes = excluded.attributes,
					confidence = greatest(public."MemoryEntity".confidence, excluded.confidence),
					"sourceMemoryId" = excluded."sourceMemoryId",
					"updatedAt" = now()
				returning id
			`;
			if (rows[0]?.id) entityIds.set(entityKey, rows[0].id);
		}

		for (const relation of relations) {
			const subjectId = entityIds.get(keyToken(relation.subjectKey));
			const objectId = entityIds.get(keyToken(relation.objectKey));
			const predicate = predicateToken(relation.predicate);
			if (!subjectId || !objectId || subjectId === objectId || !predicate) continue;
			await tx.$executeRaw`
				insert into public."MemoryRelation"
					(id, "userId", "subjectEntityId", predicate, "objectEntityId", "evidenceMemoryId", confidence, "updatedAt")
				values
					(${randomUUID()}, ${args.userId}, ${subjectId}, ${predicate}, ${objectId}, ${args.sourceMemoryId}, ${boundedConfidence(relation.confidence)}, now())
				on conflict ("userId", "subjectEntityId", predicate, "objectEntityId") do update set
					"evidenceMemoryId" = excluded."evidenceMemoryId",
					confidence = greatest(public."MemoryRelation".confidence, excluded.confidence),
					status = 'ACTIVE',
					"updatedAt" = now()
			`;
		}
	});
}

/** Hybrid graph recall. It is additive to lexical/vector memory and intentionally bounded. */
export async function getRelevantGraphContext(userId: string, query: string, limit = 8): Promise<string[]> {
	if (!enabled()) return [];
	const terms = queryTerms(query);
	if (terms.length === 0) return [];
	const rows = await prisma.$queryRaw<GraphRow[]>`
		select
			e.id as "entityId",
			e."entityType" as "entityType",
			e.label,
			e.attributes,
			r.predicate,
			o.label as "objectLabel",
			least(e.confidence, coalesce(r.confidence, e.confidence))::double precision as confidence,
			greatest(e."updatedAt", coalesce(r."updatedAt", e."updatedAt")) as "updatedAt"
		from public."MemoryEntity" e
		left join public."MemoryRelation" r
			on r."userId" = e."userId" and r."subjectEntityId" = e.id and r.status = 'ACTIVE'
		left join public."MemoryEntity" o on o.id = r."objectEntityId"
		where e."userId" = ${userId}
		order by e."updatedAt" desc
		limit 160
	`;

	const ranked = rows
		.map((row) => {
			const haystack = `${row.label} ${row.entityType} ${row.predicate ?? ""} ${row.objectLabel ?? ""}`.toLowerCase();
			const lexical = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
			return { row, score: lexical * 10 + row.confidence };
		})
		.filter((entry) => entry.score >= 10)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.min(Math.max(limit, 1), 12));

	return ranked.map(({ row }) =>
		row.predicate && row.objectLabel
			? `${row.label} —${row.predicate}→ ${row.objectLabel} (confidence ${row.confidence.toFixed(2)})`
			: `${row.label} [${row.entityType}] (confidence ${row.confidence.toFixed(2)})`,
	);
}

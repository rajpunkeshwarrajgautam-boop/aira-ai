import { prisma } from "@/lib/prisma";

export type ProjectMemoryKind =
	| "GOAL"
	| "ARCHITECTURE"
	| "TECH_STACK"
	| "CONSTRAINT"
	| "ARTIFACT"
	| "DEPLOYMENT"
	| "BLOCKER"
	| "DECISION"
	| "VERIFICATION"
	| "OTHER";

export interface ProjectMemoryRecord {
	readonly id: string;
	readonly userId: string;
	readonly projectId: string;
	readonly memoryKey: string;
	readonly kind: ProjectMemoryKind;
	readonly content: string;
	readonly source: string;
	readonly importance: number;
	readonly confidence: number;
	readonly metadata: Record<string, unknown>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

function jsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalize(row: ProjectMemoryRecord): ProjectMemoryRecord {
	return { ...row, metadata: jsonObject(row.metadata) };
}

export async function rememberProjectFact(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly memoryKey: string;
	readonly kind: ProjectMemoryKind;
	readonly content: string;
	readonly source: string;
	readonly importance?: number;
	readonly confidence?: number;
	readonly metadata?: Record<string, unknown>;
}): Promise<void> {
	const memoryKey = input.memoryKey.trim().slice(0, 180);
	const content = input.content.trim().slice(0, 20_000);
	if (!memoryKey || !content) return;
	const importance = Math.max(1, Math.min(5, Math.trunc(input.importance ?? 3)));
	const confidence = Math.max(0, Math.min(1, input.confidence ?? 1));
	await prisma.$executeRaw`
		insert into "AgentProjectMemory" (
			"id","userId","projectId","memoryKey","kind","content","source","importance","confidence","metadata"
		) values (
			${crypto.randomUUID()},${input.userId},${input.projectId},${memoryKey},${input.kind},${content},
			${input.source.slice(0, 200)},${importance},${confidence},${JSON.stringify(input.metadata ?? {})}::jsonb
		)
		on conflict ("projectId","memoryKey") do update set
			"kind"=excluded."kind",
			"content"=excluded."content",
			"source"=excluded."source",
			"importance"=excluded."importance",
			"confidence"=excluded."confidence",
			"metadata"=excluded."metadata",
			"updatedAt"=current_timestamp
		where "AgentProjectMemory"."userId"=excluded."userId"
	`;
}

export async function listProjectMemory(
	userId: string,
	projectId: string,
	limit = 40,
): Promise<ProjectMemoryRecord[]> {
	const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
	const rows = await prisma.$queryRaw<ProjectMemoryRecord[]>`
		select m.* from "AgentProjectMemory" m
		join "AgentProject" p on p."id"=m."projectId"
		where m."userId"=${userId} and m."projectId"=${projectId} and p."userId"=${userId}
		order by m."importance" desc, m."updatedAt" desc
		limit ${safeLimit}
	`;
	return rows.map(normalize);
}

function terms(value: string): Set<string> {
	return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length >= 3));
}

/** Lightweight deterministic retrieval. Semantic memory can augment this later. */
export async function retrieveProjectMemory(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly query: string;
	readonly limit?: number;
}): Promise<ProjectMemoryRecord[]> {
	const candidates = await listProjectMemory(input.userId, input.projectId, 80);
	const queryTerms = terms(input.query);
	return candidates
		.map((memory) => {
			const memoryTerms = terms(`${memory.memoryKey} ${memory.kind} ${memory.content}`);
			let overlap = 0;
			for (const term of queryTerms) if (memoryTerms.has(term)) overlap += 1;
			return { memory, score: memory.importance * 3 + overlap * 2 + memory.confidence };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, Math.min(12, input.limit ?? 8)))
		.map((entry) => entry.memory);
}

export async function deleteProjectMemory(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly memoryKey: string;
}): Promise<boolean> {
	const affected = await prisma.$executeRaw`
		delete from "AgentProjectMemory" m
		using "AgentProject" p
		where m."projectId"=p."id"
		  and m."projectId"=${input.projectId}
		  and m."userId"=${input.userId}
		  and p."userId"=${input.userId}
		  and m."memoryKey"=${input.memoryKey.trim().slice(0, 180)}
	`;
	return affected > 0;
}

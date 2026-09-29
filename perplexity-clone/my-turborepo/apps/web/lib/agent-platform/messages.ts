import { prisma } from "@/lib/prisma";

export type AgentMessageKind = "INSTRUCTION" | "PROGRESS" | "BLOCKER" | "HANDOFF" | "RESULT" | "STEERING";

function sanitize(value: unknown, depth = 0): unknown {
	if (depth > 5) return "[truncated]";
	if (typeof value === "string") return value.length > 6_000 ? `${value.slice(0, 6_000)}…` : value;
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitize(entry, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, 50)
				.map(([key, child]) => [
					/(password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)/i.test(key) ? key : key,
					/(password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)/i.test(key)
						? "[redacted]"
						: sanitize(child, depth + 1),
				]),
		);
	}
	return String(value);
}

export async function recordAgentMessage(input: {
	readonly projectId: string;
	readonly runId: string;
	readonly taskId?: string | null;
	readonly agentId?: string | null;
	readonly kind: AgentMessageKind;
	readonly body: Record<string, unknown>;
}): Promise<void> {
	const body = JSON.stringify(sanitize(input.body));
	if (Buffer.byteLength(body, "utf8") > 32_000) {
		throw new Error("Agent message exceeds the 32 KB handoff limit.");
	}
	await prisma.$executeRaw`
		insert into "AgentMessage" ("id","projectId","runId","taskId","agentId","kind","body")
		values (${crypto.randomUUID()},${input.projectId},${input.runId},${input.taskId ?? null},${input.agentId ?? null},${input.kind},${body}::jsonb)
	`;
}


export interface AgentMessageRecord {
	readonly id: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string | null;
	readonly agentId: string | null;
	readonly kind: AgentMessageKind;
	readonly body: Record<string, unknown>;
	readonly createdAt: Date;
}

function objectBody(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export async function listAgentMessagesForTasks(input: {
	readonly userId: string;
	readonly runId: string;
	readonly taskIds: readonly string[];
	readonly kinds?: readonly AgentMessageKind[];
}): Promise<AgentMessageRecord[]> {
	const taskIds = [...new Set(input.taskIds.filter(Boolean))].slice(0, 50);
	if (!taskIds.length) return [];
	const kinds = input.kinds?.length ? [...new Set(input.kinds)] : ["HANDOFF", "RESULT"];
	const rows = await prisma.$queryRaw<Array<Omit<AgentMessageRecord, "body"> & { body: unknown }>>`
		select m."id",m."projectId",m."runId",m."taskId",m."agentId",m."kind",m."body",m."createdAt"
		from "AgentMessage" m
		join "AgentPlatformRun" r on r."id"=m."runId" and r."projectId"=m."projectId"
		where m."runId"=${input.runId}
		  and r."userId"=${input.userId}
		  and m."taskId" = any(${taskIds}::text[])
		  and m."kind" = any(${kinds}::text[])
		order by m."createdAt" asc
	`;
	return rows.map((row) => ({ ...row, body: objectBody(row.body) }));
}

export async function listRunAgentMessages(input: {
	readonly userId: string;
	readonly runId: string;
	readonly limit?: number;
}): Promise<AgentMessageRecord[]> {
	const limit = Math.min(Math.max(Math.trunc(input.limit ?? 150), 1), 300);
	const rows = await prisma.$queryRaw<Array<Omit<AgentMessageRecord, "body"> & { body: unknown }>>`
		select m."id",m."projectId",m."runId",m."taskId",m."agentId",m."kind",m."body",m."createdAt"
		from "AgentMessage" m
		join "AgentPlatformRun" r on r."id"=m."runId" and r."projectId"=m."projectId"
		where m."runId"=${input.runId} and r."userId"=${input.userId}
		order by m."createdAt" desc
		limit ${limit}
	`;
	return rows.map((row) => ({ ...row, body: objectBody(row.body) }));
}

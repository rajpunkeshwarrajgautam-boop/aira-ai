import { prisma } from "@/lib/prisma";

export type WorktreeStatus = "CREATING" | "READY" | "DIRTY" | "INTEGRATED" | "CONFLICT" | "FAILED" | "CLEANED";

export interface WorktreeRecord {
	readonly id: string;
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly workspaceId: string;
	readonly branch: string;
	readonly baseRef: string;
	readonly status: WorktreeStatus;
	readonly metadata: Record<string, unknown>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

function jsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function normalize(row: WorktreeRecord): WorktreeRecord {
	return { ...row, metadata: jsonObject(row.metadata) };
}

export async function getWorktreeForUser(userId: string, workspaceId: string): Promise<WorktreeRecord | null> {
	const rows = await prisma.$queryRaw<WorktreeRecord[]>`
		select * from "AgentWorktree"
		where "workspaceId"=${workspaceId} and "userId"=${userId}
		limit 1
	`;
	return rows[0] ? normalize(rows[0]) : null;
}

export async function getTaskWorktree(userId: string, taskId: string): Promise<WorktreeRecord | null> {
	const rows = await prisma.$queryRaw<WorktreeRecord[]>`
		select * from "AgentWorktree"
		where "taskId"=${taskId} and "userId"=${userId}
		limit 1
	`;
	return rows[0] ? normalize(rows[0]) : null;
}

export async function createWorktreeRecord(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly workspaceId: string;
	readonly branch: string;
	readonly baseRef: string;
	readonly metadata?: Record<string, unknown>;
}): Promise<WorktreeRecord> {
	const existing = await getTaskWorktree(input.userId, input.taskId);
	if (existing) return existing;
	const id = crypto.randomUUID();
	try {
		const rows = await prisma.$queryRaw<WorktreeRecord[]>`
			insert into "AgentWorktree" (
				"id","userId","projectId","runId","taskId","workspaceId","branch","baseRef","metadata"
			) values (
				${id},${input.userId},${input.projectId},${input.runId},${input.taskId},${input.workspaceId},
				${input.branch},${input.baseRef},${JSON.stringify(input.metadata ?? {})}::jsonb
			)
			returning *
		`;
		return normalize(rows[0]!);
	} catch (error) {
		const concurrent = await getTaskWorktree(input.userId, input.taskId);
		if (concurrent) return concurrent;
		throw error;
	}
}

export async function updateWorktreeStatus(
	userId: string,
	workspaceId: string,
	status: WorktreeStatus,
	metadata?: Record<string, unknown>,
): Promise<void> {
	await prisma.$executeRaw`
		update "AgentWorktree"
		set "status"=${status},
			"metadata"=case when ${metadata ? JSON.stringify(metadata) : null}::jsonb is null
				then "metadata"
				else "metadata" || ${metadata ? JSON.stringify(metadata) : null}::jsonb
			end,
			"updatedAt"=current_timestamp
		where "workspaceId"=${workspaceId} and "userId"=${userId}
	`;
}

export async function listRunWorktrees(userId: string, runId: string): Promise<WorktreeRecord[]> {
	const rows = await prisma.$queryRaw<WorktreeRecord[]>`
		select * from "AgentWorktree"
		where "runId"=${runId} and "userId"=${userId}
		order by "createdAt" asc
	`;
	return rows.map(normalize);
}

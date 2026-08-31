import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import type {
	AgentProject,
	BrowserMode,
	BrowserSessionRecord,
	PlatformEvent,
	PlatformRun,
	PlatformRunStatus,
	PlatformTask,
	PlatformTaskStatus,
	RiskClass,
	RunBudgets,
	TaskSpec,
} from "./types";
import { usageFromRuntimeResult } from "./usage";

/**
 * A claimed task is dispatched by the same Node process that obtained the DB
 * lease. Keeping the opaque lease owner process-local lets later store calls
 * fence every pre-runtime transition without exposing the owner to a model or
 * remote runtime. Database predicates remain the authority; this map is only
 * the caller's expected fencing token.
 */
const localTaskClaims = new Map<string, string>();

export class TaskClaimLostError extends Error {
	constructor(taskId: string) {
		super(`Task ${taskId} is no longer owned by this dispatcher.`);
		this.name = "TaskClaimLostError";
	}
}

function jsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function projectRow(row: AgentProject): AgentProject {
	return { ...row, config: jsonObject(row.config) };
}

function runRow(row: PlatformRun): PlatformRun {
	return { ...row, budgets: jsonObject(row.budgets) as unknown as RunBudgets };
}

function taskRow(row: PlatformTask): PlatformTask {
	return {
		...row,
		dependencies: stringArray(row.dependencies),
		inputArtifacts: stringArray(row.inputArtifacts),
		outputArtifacts: stringArray(row.outputArtifacts),
	};
}

async function accountLinkedRuntimeUsage(
	tx: Prisma.TransactionClient,
	runId: string,
	runtimeRunId: string | null,
): Promise<void> {
	if (!runtimeRunId) return;
	const rows = await tx.$queryRaw<Array<{ result: unknown }>>`
		select "result" from "AgentRun" where "id"=${runtimeRunId} limit 1
	`;
	const usage = usageFromRuntimeResult(rows[0]?.result);
	const input = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
	const output = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
	const cached = Math.max(0, Math.trunc(usage.cachedTokens ?? 0));
	const cost = Math.max(0, usage.costUsd ?? 0);
	await tx.$executeRaw`
		update "AgentPlatformRun"
		set "inputTokensUsed"="inputTokensUsed"+${input}::bigint,
			"outputTokensUsed"="outputTokensUsed"+${output}::bigint,
			"cachedTokensUsed"="cachedTokensUsed"+${cached}::bigint,
			"knownCostUsd"="knownCostUsd"+${cost}::numeric,
			"updatedAt"=current_timestamp
		where "id"=${runId}
	`;
}

export async function createProject(input: {
	readonly userId: string;
	readonly name: string;
	readonly objective: string;
	readonly config?: Record<string, unknown>;
}): Promise<AgentProject> {
	const id = crypto.randomUUID();
	const config = JSON.stringify(input.config ?? {});
	const rows = await prisma.$queryRaw<AgentProject[]>`
		insert into "AgentProject" ("id", "userId", "name", "objective", "config")
		values (${id}, ${input.userId}, ${input.name}, ${input.objective}, ${config}::jsonb)
		returning *
	`;
	return projectRow(rows[0]!);
}

export async function listProjects(userId: string): Promise<AgentProject[]> {
	const rows = await prisma.$queryRaw<AgentProject[]>`
		select * from "AgentProject"
		where "userId" = ${userId} and "status" = 'ACTIVE'
		order by "updatedAt" desc
		limit 50
	`;
	return rows.map(projectRow);
}

export async function getProjectForUser(userId: string, projectId: string): Promise<AgentProject | null> {
	const rows = await prisma.$queryRaw<AgentProject[]>`
		select * from "AgentProject" where "id" = ${projectId} and "userId" = ${userId} limit 1
	`;
	return rows[0] ? projectRow(rows[0]) : null;
}

export async function getRunByClientRequestId(userId: string, clientRequestId: string): Promise<PlatformRun | null> {
	const rows = await prisma.$queryRaw<PlatformRun[]>`
		select * from "AgentPlatformRun"
		where "userId"=${userId} and "clientRequestId"=${clientRequestId}
		limit 1
	`;
	return rows[0] ? runRow(rows[0]) : null;
}

export async function createPlatformRun(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly clientRequestId: string;
	readonly runtime: string | null;
	readonly budgets: RunBudgets;
	readonly tasks: readonly TaskSpec[];
}): Promise<PlatformRun> {
	const runId = crypto.randomUUID();
	const taskIds = new Map(input.tasks.map((task) => [task.key, crypto.randomUUID()]));
	const budgets = JSON.stringify(input.budgets);
	const operations = [
		prisma.$executeRaw`
			insert into "AgentPlatformRun" ("id", "projectId", "userId", "clientRequestId", "status", "runtime", "budgets", "startedAt")
			values (${runId}, ${input.projectId}, ${input.userId}, ${input.clientRequestId}, 'RUNNING', ${input.runtime}, ${budgets}::jsonb, current_timestamp)
		`,
		...input.tasks.map((task) => {
			const id = taskIds.get(task.key)!;
			const dependencies = JSON.stringify(task.dependencies.map((key) => taskIds.get(key)).filter(Boolean));
			const initialStatus = task.approval ? "APPROVAL_REQUIRED" : "QUEUED";
			return prisma.$executeRaw`
				insert into "AgentTask" (
					"id", "projectId", "runId", "title", "objective", "status", "priority", "agentRole", "modelTier", "dependencies", "maxAttempts"
				) values (
					${id}, ${input.projectId}, ${runId}, ${task.title}, ${task.objective}, ${initialStatus}, ${task.priority}, ${task.agentRole}, ${task.modelTier}, ${dependencies}::jsonb, ${input.budgets.maxRetries + 1}
				)
			`;
		}),
		prisma.$executeRaw`
			insert into "AgentEvent" ("id", "projectId", "runId", "type", "payload")
			values (${crypto.randomUUID()}, ${input.projectId}, ${runId}, 'run.created', ${JSON.stringify({ taskCount: input.tasks.length, runtime: input.runtime })}::jsonb)
		`,
		...input.tasks.filter((task) => task.approval).map((task) => {
			const taskId = taskIds.get(task.key)!;
			return prisma.$executeRaw`
				insert into "AgentApproval" ("id", "userId", "projectId", "runId", "taskId", "action", "risk", "context")
				values (${crypto.randomUUID()}, ${input.userId}, ${input.projectId}, ${runId}, ${taskId}, ${task.approval!.action}, ${task.approval!.risk}, ${JSON.stringify({ title: task.title })}::jsonb)
			`;
		}),
	];
	await prisma.$transaction(operations);
	return (await getRunForUser(input.userId, runId))!;
}

export async function getRunForUser(userId: string, runId: string): Promise<PlatformRun | null> {
	const rows = await prisma.$queryRaw<PlatformRun[]>`
		select * from "AgentPlatformRun" where "id" = ${runId} and "userId" = ${userId} limit 1
	`;
	return rows[0] ? runRow(rows[0]) : null;
}

export async function listProjectRuns(userId: string, projectId: string): Promise<PlatformRun[]> {
	const rows = await prisma.$queryRaw<PlatformRun[]>`
		select * from "AgentPlatformRun"
		where "projectId" = ${projectId} and "userId" = ${userId}
		order by "createdAt" desc
		limit 30
	`;
	return rows.map(runRow);
}

export async function listTasks(runId: string): Promise<PlatformTask[]> {
	const rows = await prisma.$queryRaw<PlatformTask[]>`
		select * from "AgentTask" where "runId" = ${runId} order by "priority" desc, "createdAt" asc
	`;
	return rows.map(taskRow);
}

export async function appendEvent(input: {
	readonly projectId: string;
	readonly runId: string;
	readonly taskId?: string | null;
	readonly agentId?: string | null;
	readonly type: string;
	readonly payload?: Record<string, unknown>;
}): Promise<void> {
	await prisma.$executeRaw`
		insert into "AgentEvent" ("id", "projectId", "runId", "taskId", "agentId", "type", "payload")
		values (${crypto.randomUUID()}, ${input.projectId}, ${input.runId}, ${input.taskId ?? null}, ${input.agentId ?? null}, ${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb)
	`;
}

export async function listEvents(runId: string, after?: Date): Promise<PlatformEvent[]> {
	const rows = after
		? await prisma.$queryRaw<PlatformEvent[]>`
			select * from "AgentEvent" where "runId" = ${runId} and "createdAt" > ${after} order by "createdAt" asc limit 250
		`
		: await prisma.$queryRaw<PlatformEvent[]>`
			select * from "AgentEvent" where "runId" = ${runId} order by "createdAt" asc limit 250
		`;
	return rows.map((row) => ({ ...row, payload: jsonObject(row.payload) }));
}

export async function recoverExpiredClaims(runId: string): Promise<number> {
	const expired = await prisma.$transaction(async (tx) => {
		const rows = await tx.$queryRaw<Array<{ id: string }>>`
			update "AgentTask"
			set "status"='QUEUED', "leaseOwner"=null, "leaseExpiresAt"=null, "heartbeatAt"=null,
				"lastError"=coalesce("lastError", 'Worker claim expired before remote execution started.'),
				"updatedAt"=current_timestamp
			where "runId"=${runId} and "status"='CLAIMED' and "leaseExpiresAt" < current_timestamp
			returning "id"
		`;
		for (const task of rows) {
			await tx.$executeRaw`
				update "AgentInstance"
				set "status"='STOPPED', "currentTaskId"=null, "updatedAt"=current_timestamp
				where "currentTaskId"=${task.id} and "status"='IDLE'
			`;
		}
		return rows;
	});
	for (const task of expired) localTaskClaims.delete(task.id);
	return expired.length;
}

export async function claimTask(taskId: string, workerId: string, leaseSeconds = 90): Promise<PlatformTask | null> {
	const safeLease = Math.max(15, Math.min(600, Math.trunc(leaseSeconds)));
	const rows = await prisma.$queryRaw<PlatformTask[]>`
		update "AgentTask"
		set "status" = 'CLAIMED', "leaseOwner" = ${workerId}, "leaseExpiresAt" = current_timestamp + (${safeLease} * interval '1 second'), "heartbeatAt" = current_timestamp, "updatedAt" = current_timestamp
		where "id" = ${taskId}
		  and "status" in ('QUEUED','READY')
		  and ("leaseExpiresAt" is null or "leaseExpiresAt" < current_timestamp)
		returning *
	`;
	if (!rows[0]) return null;
	localTaskClaims.set(taskId, workerId);
	return taskRow(rows[0]);
}

export async function markTaskRunning(taskId: string, runtimeRunId: string, agentId: string): Promise<void> {
	const expectedOwner = localTaskClaims.get(taskId);
	if (!expectedOwner) throw new TaskClaimLostError(taskId);
	try {
		await prisma.$transaction(async (tx) => {
			const claimed = await tx.$queryRaw<Array<{ id: string }>>`
				update "AgentTask"
				set "status"='RUNNING', "runtimeRunId"=${runtimeRunId}, "attempt"="attempt"+1,
					"startedAt"=coalesce("startedAt", current_timestamp), "heartbeatAt"=current_timestamp,
					"leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
				where "id"=${taskId}
				  and "status"='CLAIMED'
				  and "leaseOwner"=${expectedOwner}
				  and "leaseExpiresAt" >= current_timestamp
				returning "id"
			`;
			if (!claimed[0]) throw new TaskClaimLostError(taskId);
			const agentChanged = await tx.$executeRaw`
				update "AgentInstance"
				set "status"='WORKING', "currentTaskId"=${taskId}, "updatedAt"=current_timestamp
				where "id"=${agentId} and "currentTaskId"=${taskId} and "status"='IDLE'
			`;
			if (agentChanged !== 1) throw new TaskClaimLostError(taskId);
		});
	} catch (error) {
		await prisma.$executeRaw`
			update "AgentInstance"
			set "status"='STOPPED', "currentTaskId"=null, "updatedAt"=current_timestamp
			where "id"=${agentId} and "status"='IDLE'
		`.catch(() => undefined);
		throw error;
	} finally {
		localTaskClaims.delete(taskId);
	}
}

export async function createAgentInstance(input: {
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly role: string;
	readonly objective: string;
	readonly modelTier: string;
	readonly allowedTools: readonly string[];
}): Promise<string> {
	const expectedOwner = localTaskClaims.get(input.taskId);
	if (!expectedOwner) throw new TaskClaimLostError(input.taskId);
	const id = crypto.randomUUID();
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		insert into "AgentInstance" ("id", "projectId", "runId", "role", "objective", "status", "modelTier", "allowedTools", "currentTaskId")
		select ${id}, ${input.projectId}, ${input.runId}, ${input.role}, ${input.objective}, 'IDLE', ${input.modelTier}, ${JSON.stringify(input.allowedTools)}::jsonb, ${input.taskId}
		from "AgentTask" t
		where t."id"=${input.taskId}
		  and t."projectId"=${input.projectId}
		  and t."runId"=${input.runId}
		  and t."status"='CLAIMED'
		  and t."leaseOwner"=${expectedOwner}
		  and t."leaseExpiresAt" >= current_timestamp
		  and not exists (
			select 1 from "AgentInstance" existing
			where existing."currentTaskId"=t."id" and existing."status" in ('IDLE','WORKING','WAITING','PAUSED')
		  )
		returning "id"
	`;
	if (!rows[0]) {
		localTaskClaims.delete(input.taskId);
		throw new TaskClaimLostError(input.taskId);
	}
	return id;
}

/**
 * Finalize one running delegated task exactly once. The task row lock is the
 * ownership fence for runtime usage, artifacts and terminal state, so two
 * concurrent coordinators cannot double-count provider usage or duplicate
 * output artifacts for the same runtime attempt.
 */
export async function completeTask(taskId: string, outputArtifacts: readonly string[] = []): Promise<void> {
	localTaskClaims.delete(taskId);
	await prisma.$transaction(async (tx) => {
		const rows = await tx.$queryRaw<Array<{ runId: string; runtimeRunId: string | null; status: PlatformTaskStatus }>>`
			select "runId", "runtimeRunId", "status"
			from "AgentTask"
			where "id"=${taskId}
			for update
		`;
		const current = rows[0];
		if (!current || current.status !== "RUNNING") throw new TaskClaimLostError(taskId);

		await accountLinkedRuntimeUsage(tx, current.runId, current.runtimeRunId);
		const changed = await tx.$executeRaw`
			update "AgentTask"
			set "status"='COMPLETED', "outputArtifacts"=${JSON.stringify(outputArtifacts)}::jsonb,
				"leaseOwner"=null, "leaseExpiresAt"=null, "completedAt"=current_timestamp, "updatedAt"=current_timestamp
			where "id"=${taskId} and "status"='RUNNING'
		`;
		if (changed !== 1) throw new TaskClaimLostError(taskId);

		await tx.$executeRaw`
			update "AgentInstance"
			set "status"='STOPPED', "currentTaskId"=null, "updatedAt"=current_timestamp
			where "currentTaskId"=${taskId}
		`;
		for (const uri of outputArtifacts.slice(0, 50)) {
			await tx.$executeRaw`
				insert into "AgentArtifact" ("id", "projectId", "runId", "taskId", "kind", "name", "uri", "metadata")
				select ${crypto.randomUUID()}, "projectId", "runId", "id", 'runtime-output', ${uri.split('/').filter(Boolean).pop() ?? "artifact"}, ${uri}, '{}'::jsonb
				from "AgentTask" where "id"=${taskId}
			`;
		}
	});
}

export async function failTask(task: PlatformTask, message: string): Promise<PlatformTaskStatus> {
	const nextStatus: PlatformTaskStatus = task.attempt < task.maxAttempts ? "QUEUED" : "FAILED";
	const claimedOwner = task.status === "CLAIMED" ? task.leaseOwner : null;
	if (task.status === "CLAIMED" && !claimedOwner) throw new TaskClaimLostError(task.id);
	if (task.status !== "CLAIMED" && task.status !== "RUNNING") throw new TaskClaimLostError(task.id);
	try {
		await prisma.$transaction(async (tx) => {
			const currentRows = await tx.$queryRaw<Array<{ runId: string; status: PlatformTaskStatus; runtimeRunId: string | null; attempt: number; leaseOwner: string | null }>>`
				select "runId", "status", "runtimeRunId", "attempt", "leaseOwner"
				from "AgentTask"
				where "id"=${task.id}
				for update
			`;
			const current = currentRows[0];
			if (!current || current.status !== task.status || current.attempt !== task.attempt) throw new TaskClaimLostError(task.id);
			if (task.status === "RUNNING" && current.runtimeRunId !== task.runtimeRunId) throw new TaskClaimLostError(task.id);

			if (task.status === "RUNNING") {
				await accountLinkedRuntimeUsage(tx, current.runId, current.runtimeRunId);
			}

			const changed = claimedOwner
				? await tx.$executeRaw`
					update "AgentTask"
					set "status"=${nextStatus}, "runtimeRunId"=null, "leaseOwner"=null, "leaseExpiresAt"=null,
						"lastError"=${message.slice(0, 4000)}, "updatedAt"=current_timestamp,
						"completedAt"=${nextStatus === "FAILED" ? new Date() : null}
					where "id"=${task.id} and "status"='CLAIMED' and "attempt"=${task.attempt} and "leaseOwner"=${claimedOwner}
					  and "leaseExpiresAt" >= current_timestamp
				`
				: await tx.$executeRaw`
					update "AgentTask"
					set "status"=${nextStatus}, "runtimeRunId"=null, "leaseOwner"=null, "leaseExpiresAt"=null,
						"lastError"=${message.slice(0, 4000)}, "updatedAt"=current_timestamp,
						"completedAt"=${nextStatus === "FAILED" ? new Date() : null}
					where "id"=${task.id} and "status"='RUNNING' and "attempt"=${task.attempt}
					  and "runtimeRunId" is not distinct from ${task.runtimeRunId}
				`;
			if (changed !== 1) throw new TaskClaimLostError(task.id);
			await tx.$executeRaw`
				update "AgentInstance"
				set "status"=${nextStatus === "FAILED" ? "FAILED" : "STOPPED"}, "currentTaskId"=null, "updatedAt"=current_timestamp
				where "currentTaskId"=${task.id}
			`;
		});
		return nextStatus;
	} finally {
		localTaskClaims.delete(task.id);
	}
}

export async function setTaskStatus(taskId: string, status: PlatformTaskStatus): Promise<void> {
	const expectedOwner = localTaskClaims.get(taskId);
	if (expectedOwner) {
		try {
			const changed = await prisma.$executeRaw`
				update "AgentTask"
				set "status"=${status}, "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
				where "id"=${taskId} and "status"='CLAIMED' and "leaseOwner"=${expectedOwner}
				  and "leaseExpiresAt" >= current_timestamp
			`;
			if (changed !== 1) throw new TaskClaimLostError(taskId);
			return;
		} finally {
			localTaskClaims.delete(taskId);
		}
	}
	await prisma.$executeRaw`
		update "AgentTask" set "status"=${status}, "updatedAt"=current_timestamp where "id"=${taskId}
	`;
}

export async function setRunStatus(runId: string, status: PlatformRunStatus, summary?: string | null): Promise<void> {
	const terminal = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
	await prisma.$executeRaw`
		update "AgentPlatformRun" set "status"=${status}, "summary"=coalesce(${summary ?? null}, "summary"), "updatedAt"=current_timestamp, "completedAt"=${terminal ? new Date() : null} where "id"=${runId}
	`;
}

export async function listPendingApprovals(userId: string, runId?: string): Promise<Array<Record<string, unknown>>> {
	return runId
		? prisma.$queryRaw<Array<Record<string, unknown>>>`
			select * from "AgentApproval" where "userId"=${userId} and "runId"=${runId} and "status"='PENDING' order by "createdAt" asc
		`
		: prisma.$queryRaw<Array<Record<string, unknown>>>`
			select * from "AgentApproval" where "userId"=${userId} and "status"='PENDING' order by "createdAt" asc limit 100
		`;
}

export async function resolveApproval(input: { readonly userId: string; readonly approvalId: string; readonly approve: boolean }): Promise<{ taskId: string; runId: string; projectId: string } | null> {
	const rows = await prisma.$queryRaw<Array<{ taskId: string | null; runId: string; projectId: string }>>`
		update "AgentApproval" set "status"=${input.approve ? "APPROVED" : "REJECTED"}, "resolvedAt"=current_timestamp
		where "id"=${input.approvalId} and "userId"=${input.userId} and "status"='PENDING'
		returning "taskId", "runId", "projectId"
	`;
	const row = rows[0];
	if (!row?.taskId) return null;
	await setTaskStatus(row.taskId, input.approve ? "QUEUED" : "CANCELLED");
	return { taskId: row.taskId, runId: row.runId, projectId: row.projectId };
}

export async function createBrowserSession(input: {
	readonly userId: string;
	readonly projectId?: string | null;
	readonly runId?: string | null;
	readonly taskId?: string | null;
	readonly mode: BrowserMode;
	readonly allowedDomains: readonly string[];
	readonly permissions: readonly string[];
	readonly ttlMinutes: number;
}): Promise<BrowserSessionRecord> {
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);
	const rows = await prisma.$queryRaw<BrowserSessionRecord[]>`
		insert into "BrowserSession" ("id","userId","projectId","runId","taskId","mode","allowedDomains","permissions","expiresAt")
		values (${id},${input.userId},${input.projectId ?? null},${input.runId ?? null},${input.taskId ?? null},${input.mode},${JSON.stringify(input.allowedDomains)}::jsonb,${JSON.stringify(input.permissions)}::jsonb,${expiresAt})
		returning *
	`;
	const row = rows[0]!;
	return { ...row, allowedDomains: stringArray(row.allowedDomains), permissions: stringArray(row.permissions) };
}

export async function listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]> {
	const rows = await prisma.$queryRaw<BrowserSessionRecord[]>`
		select * from "BrowserSession" where "userId"=${userId} order by "updatedAt" desc limit 50
	`;
	return rows.map((row) => ({ ...row, allowedDomains: stringArray(row.allowedDomains), permissions: stringArray(row.permissions) }));
}

export async function getBrowserSession(userId: string, sessionId: string): Promise<BrowserSessionRecord | null> {
	const rows = await prisma.$queryRaw<BrowserSessionRecord[]>`
		select * from "BrowserSession" where "id"=${sessionId} and "userId"=${userId} limit 1
	`;
	const row = rows[0];
	return row ? { ...row, allowedDomains: stringArray(row.allowedDomains), permissions: stringArray(row.permissions) } : null;
}

export async function updateBrowserSession(input: {
	readonly sessionId: string;
	readonly status?: BrowserSessionRecord["status"];
	readonly remoteSessionId?: string | null;
	readonly currentUrl?: string | null;
	readonly screenshotUri?: string | null;
}): Promise<void> {
	await prisma.$executeRaw`
		update "BrowserSession" set
			"status"=coalesce(${input.status ?? null}, "status"),
			"remoteSessionId"=coalesce(${input.remoteSessionId ?? null}, "remoteSessionId"),
			"currentUrl"=coalesce(${input.currentUrl ?? null}, "currentUrl"),
			"lastScreenshotUri"=coalesce(${input.screenshotUri ?? null}, "lastScreenshotUri"),
			"updatedAt"=current_timestamp
		where "id"=${input.sessionId}
	`;
}

export async function recordBrowserAction(input: {
	readonly sessionId: string;
	readonly source: "AGENT" | "HUMAN" | "SYSTEM";
	readonly action: string;
	readonly target?: string | null;
	readonly result?: Record<string, unknown> | null;
	readonly risk: RiskClass;
	readonly screenshotUri?: string | null;
}): Promise<void> {
	await prisma.$executeRaw`
		insert into "BrowserAction" ("id","sessionId","source","action","target","result","risk","screenshotUri")
		values (${crypto.randomUUID()},${input.sessionId},${input.source},${input.action},${input.target ?? null},${input.result ? JSON.stringify(input.result) : null}::jsonb,${input.risk},${input.screenshotUri ?? null})
	`;
}

export async function listBrowserActions(userId: string, sessionId: string): Promise<Array<Record<string, unknown>>> {
	return prisma.$queryRaw<Array<Record<string, unknown>>>`
		select a.* from "BrowserAction" a join "BrowserSession" s on s."id"=a."sessionId"
		where a."sessionId"=${sessionId} and s."userId"=${userId}
		order by a."createdAt" desc limit 100
	`;
}

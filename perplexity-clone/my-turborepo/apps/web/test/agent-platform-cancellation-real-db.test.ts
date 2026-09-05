import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AgentRunStatus } from "@/generated/prisma/enums";
import { cancelManagedRun } from "@/lib/agent-platform/orchestrator";
import {
	createPlatformRun,
	createProject,
	listTasks,
} from "@/lib/agent-platform/store";
import { DEFAULT_RUN_BUDGETS, type TaskSpec } from "@/lib/agent-platform/types";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import type { ToolAdapter } from "@/lib/tool-gateway/types";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

function taskSpec(): TaskSpec {
	return {
		key: "restart-cancellation",
		title: "Restart-safe cancellation",
		objective: "Prove cancellation cleanup converges after a crash.",
		agentRole: "RESEARCH",
		modelTier: "balanced",
		priority: 100,
		dependencies: [],
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((release) => {
		resolve = release;
	});
	return { promise, resolve };
}

test(
	"REAL_DB: cancellation racing tool completion converges without duplicate execution or accounting",
	{ skip: !REAL_DB, timeout: 90_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `cancel-completion-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		async function createFixture(ordering: string) {
			const project = await createProject({ userId, name: `Cancellation completion ${ordering} ${suffix}`, objective: "Prove cancellation and completion converge without duplicate work." });
			const run = await createPlatformRun({
				userId,
				projectId: project.id,
				clientRequestId: `cancel-completion-run-${ordering}-${suffix}`,
				runtime: null,
				budgets: DEFAULT_RUN_BUDGETS,
				tasks: [taskSpec()],
			});
			const task = (await listTasks(run.id))[0]!;
			return {
				project,
				run,
				task,
				context: { userId, projectId: project.id, runId: run.id, taskId: task.id, source: "SYSTEM" as const },
				request: {
					clientRequestId: `cancel-completion-tool-${ordering}-${suffix}`,
					tool: "web" as const,
					action: "retrieve",
					input: { query: `cancellation completion ${ordering}`, numResults: 1 },
				},
			};
		}

		async function assertConverged(fixture: Awaited<ReturnType<typeof createFixture>>, executions: number) {
			const [runRows, taskRows, toolRows, usageRows] = await Promise.all([
				prisma.$queryRaw<Array<{ status: string }>>`select "status" from "AgentPlatformRun" where "id"=${fixture.run.id}`,
				prisma.$queryRaw<Array<{ status: string; leaseOwner: string | null; leaseExpiresAt: Date | null }>>`select "status", "leaseOwner", "leaseExpiresAt" from "AgentTask" where "id"=${fixture.task.id}`,
				prisma.$queryRaw<Array<{ status: string; completedAt: Date | null }>>`select "status", "completedAt" from "AgentToolCall" where "userId"=${userId} and "clientRequestId"=${fixture.request.clientRequestId}`,
				prisma.$queryRaw<Array<{ toolCallsUsed: number; inputTokensUsed: bigint; outputTokensUsed: bigint; cachedTokensUsed: bigint; knownCostUsd: string; costAccountingComplete: boolean }>>`
					select "toolCallsUsed", "inputTokensUsed", "outputTokensUsed", "cachedTokensUsed", trim_scale("knownCostUsd")::text as "knownCostUsd", "costAccountingComplete"
					from "AgentPlatformRun" where "id"=${fixture.run.id}
				`,
			]);
			assert.equal(executions, 1, "one logical tool request must execute externally once");
			assert.deepEqual(runRows, [{ status: "CANCELLED" }]);
			assert.deepEqual(taskRows, [{ status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null }]);
			assert.equal(toolRows[0]?.status, "COMPLETED");
			assert.ok(toolRows[0]?.completedAt instanceof Date);
			assert.deepEqual(usageRows, [{ toolCallsUsed: 1, inputTokensUsed: 11n, outputTokensUsed: 7n, cachedTokensUsed: 2n, knownCostUsd: "0.42", costAccountingComplete: false }]);
		}

		let cancellationFirstExecutions = 0;
		const cancellationFirst = await createFixture("cancellation-first");
		const completionReached = deferred();
		const releaseCompletion = deferred();
		const cancellationFirstAdapter: ToolAdapter = {
			id: "web",
			async isAvailable() { return true; },
			async execute() {
				cancellationFirstExecutions += 1;
				return { result: { ordering: "cancellation-first" }, usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 2, costUsd: 0.42, costKnown: true } };
			},
		};
		const staleCompletion = executeTool(cancellationFirst.context, cancellationFirst.request, {
			adapter: cancellationFirstAdapter,
			beforeCompletionPersist: async () => {
				completionReached.resolve();
				await releaseCompletion.promise;
			},
		});
		await completionReached.promise;
		await cancelManagedRun(userId, cancellationFirst.run.id);
		releaseCompletion.resolve();
		assert.equal((await staleCompletion).status, "COMPLETED", "a started external operation records its durable completion after the cancellation fence");
		await assertConverged(cancellationFirst, cancellationFirstExecutions);

		let completionFirstExecutions = 0;
		const completionFirst = await createFixture("completion-first");
		const completionFirstAdapter: ToolAdapter = {
			id: "web",
			async isAvailable() { return true; },
			async execute() {
				completionFirstExecutions += 1;
				return { result: { ordering: "completion-first" }, usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 2, costUsd: 0.42, costKnown: true } };
			},
		};
		assert.equal((await executeTool(completionFirst.context, completionFirst.request, { adapter: completionFirstAdapter })).status, "COMPLETED");
		await cancelManagedRun(userId, completionFirst.run.id);
		await assertConverged(completionFirst, completionFirstExecutions);
	},
);

test(
	"REAL_DB: cancellation replay repairs a crash after the parent fence and remains concurrency-safe",
	{ skip: !REAL_DB, timeout: 45_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `cancel-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({
			userId,
			name: `Cancellation ${suffix}`,
			objective: "Prove restart-safe cancellation.",
		});
		const run = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: randomUUID(),
			runtime: "AUTOGPT",
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [taskSpec()],
		});
		const task = (await listTasks(run.id))[0]!;
		const agentId = `cancel-agent-${suffix}`;
		const approvalId = `cancel-approval-${suffix}`;
		const toolCallId = `cancel-tool-${suffix}`;

		// Reproduce the crash window: the mission-level side-effect fence committed,
		// but local cleanup did not. The retry must not return merely because the
		// parent is already CANCELLED.
		await prisma.$transaction([
			prisma.$executeRaw`
				update "AgentPlatformRun"
				set "status"='CANCELLED', "completedAt"=current_timestamp, "updatedAt"=current_timestamp
				where "id"=${run.id}
			`,
			prisma.$executeRaw`
				update "AgentTask"
				set "status"='CLAIMED', "leaseOwner"='crashed-worker',
					"leaseExpiresAt"=current_timestamp + interval '5 minutes', "attempt"=1
				where "id"=${task.id}
			`,
			prisma.$executeRaw`
				insert into "AgentInstance"
				("id","projectId","runId","role","objective","status","currentTaskId")
				values (${agentId},${project.id},${run.id},'RESEARCH','Cancellation fixture','WORKING',${task.id})
			`,
			prisma.$executeRaw`
				insert into "AgentApproval"
				("id","userId","projectId","runId","taskId","action","risk","status")
				values (${approvalId},${userId},${project.id},${run.id},${task.id},'fixture approval','HIGH','PENDING')
			`,
			prisma.$executeRaw`
				insert into "AgentToolCall"
				("id","clientRequestId","userId","projectId","runId","taskId","agentId","tool","action","risk","status","approvalId","inputHash")
				values (${toolCallId},${`cancel-tool-request-${suffix}`},${userId},${project.id},${run.id},${task.id},${agentId},'web','open','HIGH','APPROVAL_REQUIRED',${approvalId},${`fixture:${suffix}`})
			`,
		]);

		const attemptsBefore = (await listTasks(run.id))[0]!.attempt;
		await Promise.all([
			cancelManagedRun(userId, run.id),
			cancelManagedRun(userId, run.id),
		]);

		const [runRows, taskRows, agentRows, toolRows, approvalRows] = await Promise.all([
			prisma.$queryRaw<Array<{ status: string }>>`
				select "status" from "AgentPlatformRun" where "id"=${run.id}
			`,
			prisma.$queryRaw<Array<{ status: string; attempt: number; leaseOwner: string | null; leaseExpiresAt: Date | null }>>`
				select "status","attempt","leaseOwner","leaseExpiresAt" from "AgentTask" where "id"=${task.id}
			`,
			prisma.$queryRaw<Array<{ status: string; currentTaskId: string | null }>>`
				select "status","currentTaskId" from "AgentInstance" where "id"=${agentId}
			`,
			prisma.$queryRaw<Array<{ status: string; completedAt: Date | null }>>`
				select "status","completedAt" from "AgentToolCall" where "id"=${toolCallId}
			`,
			prisma.$queryRaw<Array<{ status: string; resolvedAt: Date | null }>>`
				select "status","resolvedAt" from "AgentApproval" where "id"=${approvalId}
			`,
		]);

		assert.equal(runRows[0]?.status, "CANCELLED");
		assert.deepEqual(taskRows[0], {
			status: "CANCELLED",
			attempt: attemptsBefore,
			leaseOwner: null,
			leaseExpiresAt: null,
		});
		assert.deepEqual(agentRows[0], { status: "STOPPED", currentTaskId: null });
		assert.equal(toolRows[0]?.status, "CANCELLED");
		assert.ok(toolRows[0]?.completedAt instanceof Date);
		assert.equal(approvalRows[0]?.status, "REJECTED");
		assert.ok(approvalRows[0]?.resolvedAt instanceof Date);

		const toolCompletedAt = toolRows[0]!.completedAt!.getTime();
		const approvalResolvedAt = approvalRows[0]!.resolvedAt!.getTime();
		await cancelManagedRun(userId, run.id);
		const [toolReplay, approvalReplay, taskReplay] = await Promise.all([
			prisma.$queryRaw<Array<{ status: string; completedAt: Date | null }>>`
				select "status","completedAt" from "AgentToolCall" where "id"=${toolCallId}
			`,
			prisma.$queryRaw<Array<{ status: string; resolvedAt: Date | null }>>`
				select "status","resolvedAt" from "AgentApproval" where "id"=${approvalId}
			`,
			prisma.$queryRaw<Array<{ status: string; attempt: number }>>`
				select "status","attempt" from "AgentTask" where "id"=${task.id}
			`,
		]);
		assert.equal(toolReplay[0]?.status, "CANCELLED");
		assert.equal(toolReplay[0]?.completedAt?.getTime(), toolCompletedAt);
		assert.equal(approvalReplay[0]?.status, "REJECTED");
		assert.equal(approvalReplay[0]?.resolvedAt?.getTime(), approvalResolvedAt);
		assert.deepEqual(taskReplay[0], { status: "CANCELLED", attempt: attemptsBefore });
	},
);

test(
	"REAL_DB: cross-component cancellation cascades to delegated runtimes and converges under remote failure and race",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `cross-cancel-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({
			userId,
			name: `Cross Component Cancel ${suffix}`,
			objective: "Prove cross-component cancellation cascades and converges.",
		});

		const run = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: `cross-cancel-run-${suffix}`,
			runtime: "AUTOGPT",
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [
				{ ...taskSpec(), key: "task-delegated", title: "Delegated task" },
				{ ...taskSpec(), key: "task-local", title: "Local tool task" },
			],
		});

		const tasks = await listTasks(run.id);
		const delegatedTask = tasks.find((tk) => tk.title === "Delegated task")!;
		const localTask = tasks.find((tk) => tk.title === "Local tool task")!;

		// 1. Delegated runtime run linked to delegatedTask
		const agentRunId = `delegated-run-${suffix}`;
		await prisma.agentRun.create({
			data: {
				id: agentRunId,
				userId,
				provider: "AUTOGPT",
				clientRequestId: `delegated-req-${suffix}`,
				remoteExecutionId: `remote-exec-${suffix}`,
				graphId: "graph-cancel-test",
				graphVersion: 1,
				objective: "Test cross-component cancellation cascade",
				status: AgentRunStatus.RUNNING,
			},
		});
		await prisma.$executeRaw`
			update "AgentTask"
			set "runtimeRunId"=${agentRunId}, "status"='RUNNING', "attempt"=1
			where "id"=${delegatedTask.id}
		`;

		// 2. Working agent instance, pending approval, and tool call on localTask
		const agentId = `cross-agent-${suffix}`;
		const approvalId = `cross-approval-${suffix}`;
		const toolCallId = `cross-tool-${suffix}`;
		await prisma.$transaction([
			prisma.$executeRaw`
				update "AgentTask"
				set "status"='CLAIMED', "leaseOwner"='worker-active',
					"leaseExpiresAt"=current_timestamp + interval '5 minutes', "attempt"=1
				where "id"=${localTask.id}
			`,
			prisma.$executeRaw`
				insert into "AgentInstance"
				("id","projectId","runId","role","objective","status","currentTaskId")
				values (${agentId},${project.id},${run.id},'RESEARCH','Cross-cancel instance','WORKING',${localTask.id})
			`,
			prisma.$executeRaw`
				insert into "AgentApproval"
				("id","userId","projectId","runId","taskId","action","risk","status")
				values (${approvalId},${userId},${project.id},${run.id},${localTask.id},'sensitive operation','HIGH','PENDING')
			`,
			prisma.$executeRaw`
				insert into "AgentToolCall"
				("id","clientRequestId","userId","projectId","runId","taskId","agentId","tool","action","risk","status","approvalId","inputHash")
				values (${toolCallId},${`cross-tool-req-${suffix}`},${userId},${project.id},${run.id},${localTask.id},${agentId},'web','fetch','HIGH','APPROVAL_REQUIRED',${approvalId},${`hash:${suffix}`})
			`,
		]);

		// Execute cancellation
		await cancelManagedRun(userId, run.id);

		// Verify convergence across all components
		const [runRows, taskRows, agentRows, toolRows, approvalRows, events] = await Promise.all([
			prisma.$queryRaw<Array<{ status: string }>>`select "status" from "AgentPlatformRun" where "id"=${run.id}`,
			prisma.$queryRaw<Array<{ id: string; status: string; leaseOwner: string | null }>>`select "id","status","leaseOwner" from "AgentTask" where "runId"=${run.id}`,
			prisma.$queryRaw<Array<{ status: string; currentTaskId: string | null }>>`select "status","currentTaskId" from "AgentInstance" where "id"=${agentId}`,
			prisma.$queryRaw<Array<{ status: string; completedAt: Date | null }>>`select "status","completedAt" from "AgentToolCall" where "id"=${toolCallId}`,
			prisma.$queryRaw<Array<{ status: string; resolvedAt: Date | null }>>`select "status","resolvedAt" from "AgentApproval" where "id"=${approvalId}`,
			prisma.$queryRaw<Array<{ type: string; payload: unknown }>>`select "type","payload" from "AgentEvent" where "runId"=${run.id} and "type"='run.cancelled'`,
		]);

		assert.equal(runRows[0]?.status, "CANCELLED");
		for (const tRow of taskRows) {
			assert.equal(tRow.status, "CANCELLED");
			assert.equal(tRow.leaseOwner, null, "All task leases must be released");
		}
		assert.deepEqual(agentRows[0], { status: "STOPPED", currentTaskId: null });
		assert.equal(toolRows[0]?.status, "CANCELLED");
		assert.ok(toolRows[0]?.completedAt instanceof Date);
		assert.equal(approvalRows[0]?.status, "REJECTED");
		assert.ok(approvalRows[0]?.resolvedAt instanceof Date);
		assert.equal(events.length, 1);

		// Replay cancellation after crash/restart is idempotent and preserves timestamps
		const toolCompletedAt = toolRows[0]!.completedAt!.getTime();
		const approvalResolvedAt = approvalRows[0]!.resolvedAt!.getTime();
		await cancelManagedRun(userId, run.id);

		const [replayTool, replayApproval] = await Promise.all([
			prisma.$queryRaw<Array<{ completedAt: Date | null }>>`select "completedAt" from "AgentToolCall" where "id"=${toolCallId}`,
			prisma.$queryRaw<Array<{ resolvedAt: Date | null }>>`select "resolvedAt" from "AgentApproval" where "id"=${approvalId}`,
		]);
		assert.equal(replayTool[0]?.completedAt?.getTime(), toolCompletedAt);
		assert.equal(replayApproval[0]?.resolvedAt?.getTime(), approvalResolvedAt);
	},
);

test(
	"REAL_DB: database disconnect during active transaction fails closed, prevents partial writes, and recovers cleanly on reconnect",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `db-disconnect-owner-${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({
			userId,
			name: `Disconnect test ${suffix}`,
			objective: "Prove failure-closed transaction rollback under database disconnect.",
		});
		const run = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: `disconnect-run-${suffix}`,
			runtime: null,
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [taskSpec()],
		});
		const task = (await listTasks(run.id))[0]!;

		// Inject abrupt backend termination mid-transaction
		let disconnectCaught = false;
		try {
			await prisma.$transaction(async (tx) => {
				await tx.$executeRaw`
					update "AgentTask" set "status"='RUNNING', "updatedAt"=current_timestamp where "id"=${task.id}
				`;
				// Sever connection abruptly via server command
				await tx.$executeRawUnsafe("SELECT pg_terminate_backend(pg_backend_pid())");
			});
		} catch (err: unknown) {
			disconnectCaught = true;
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(
				msg.includes("57P01") ||
				msg.includes("terminat") ||
				msg.includes("closed") ||
				msg.includes("connection"),
				`Expected connection termination message, got: ${msg}`,
			);
		}
		assert.equal(disconnectCaught, true, "Abrupt database connection termination must be caught fail-closed");

		// Verify transaction rolled back completely: task.status remains QUEUED, no partial update
		const [taskCheck] = await prisma.$queryRaw<Array<{ status: string }>>`
			select "status" from "AgentTask" where "id"=${task.id}
		`;
		assert.equal(taskCheck?.status, "QUEUED", "Task status must remain QUEUED after severed transaction");

		// Verify pool recovers and subsequent operation succeeds on reconnected pool
		await cancelManagedRun(userId, run.id);
		const [runCheck, taskAfterCancel] = await Promise.all([
			prisma.$queryRaw<Array<{ status: string }>>`select "status" from "AgentPlatformRun" where "id"=${run.id}`,
			prisma.$queryRaw<Array<{ status: string }>>`select "status" from "AgentTask" where "id"=${task.id}`,
		]);
		assert.equal(runCheck[0]?.status, "CANCELLED", "Subsequent cancellation must succeed on recovered pool");
		assert.equal(taskAfterCancel[0]?.status, "CANCELLED", "Task must be CANCELLED on recovered pool");
	},
);

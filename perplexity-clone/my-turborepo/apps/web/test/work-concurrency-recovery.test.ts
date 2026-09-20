import fs from "node:fs";
if (fs.existsSync(".env.local")) {
  try { process.loadEnvFile(".env.local"); } catch (_err) { /* ignore */ }
}
const HAS_DB = Boolean(process.env.DATABASE_URL);
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import {
	createPlatformRun,
	claimTask,
	markTaskRunning,
	heartbeatTask,
	recoverExpiredClaims,
	completeTask,
	getRunForUser,
	listTasks,
} from "../lib/agent-platform/store";
import { cancelManagedRun } from "../lib/agent-platform/orchestrator";
import { DEFAULT_RUN_BUDGETS } from "../lib/agent-platform/types";

const testUserId = `usr_test_${crypto.randomUUID().slice(0, 8)}`;
const testProjectId = `prj_test_${crypto.randomUUID().slice(0, 8)}`;

test.before(async () => {
	if (!HAS_DB) return;
	// Seed a test user and project in Neon Preview DB
	await prisma.$executeRaw`
		insert into "User" ("id", "email", "name")
		values (${testUserId}, ${`${testUserId}@example.com`}, 'Test Concurrency User')
		on conflict ("id") do nothing
	`;
	await prisma.$executeRaw`
		insert into "AgentProject" ("id", "userId", "name", "objective", "config")
		values (${testProjectId}, ${testUserId}, 'Concurrency & Recovery Test Suite', 'Validate durable queue claiming and crash recovery', '{}'::jsonb)
		on conflict ("id") do nothing
	`;
});

test.after(async () => {
	if (!HAS_DB) return;
	// Clean up test runs, tasks, instances, and project in dependency order
	await prisma.$executeRaw`delete from "AgentApproval" where "projectId"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentEvent" where "projectId"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentInstance" where "projectId"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentTask" where "projectId"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentPlatformRun" where "projectId"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentRun" where "userId"=${testUserId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "AgentProject" where "id"=${testProjectId}`.catch(() => undefined);
	await prisma.$executeRaw`delete from "User" where "id"=${testUserId}`.catch(() => undefined);
});

test("Phase 5 & 19: Exclusive claim prevents duplicate execution between concurrent workers", async () => {
	const run = await createPlatformRun({
		userId: testUserId,
		projectId: testProjectId,
		clientRequestId: `req_${crypto.randomUUID()}`,
		runtime: "AIRA_AGENT",
		budgets: { ...DEFAULT_RUN_BUDGETS, maxRetries: 2 },
		tasks: [
			{
				key: "exclusive-task-1",
				title: "Concurrency exclusion task",
				objective: "Verify only one worker can claim",
				agentRole: "RESEARCH",
				modelTier: "reasoning",
				priority: 100,
				dependencies: [],
			},
		],
	});

	const tasks = await listTasks(run.id);
	assert.equal(tasks.length, 1);
	const targetTask = tasks[0]!;

	const worker1 = `worker:alpha:${crypto.randomUUID().slice(0, 6)}`;
	const worker2 = `worker:beta:${crypto.randomUUID().slice(0, 6)}`;

	// Simulate simultaneous claims by worker1 and worker2
	const [claim1, claim2] = await Promise.all([
		claimTask(targetTask.id, worker1, 60),
		claimTask(targetTask.id, worker2, 60),
	]);

	// Exactly one worker must succeed, and the other must get null
	const successfulClaims = [claim1, claim2].filter(Boolean);
	assert.equal(successfulClaims.length, 1, "Exactly one worker must obtain exclusive claim");

	const winner = claim1 ?? claim2;
	assert.ok(winner);
	assert.equal(winner.status, "CLAIMED");
	assert.ok(winner.leaseOwner === worker1 || winner.leaseOwner === worker2);

	// A third worker also cannot claim while lease is active
	const worker3 = `worker:gamma:${crypto.randomUUID().slice(0, 6)}`;
	const claim3 = await claimTask(targetTask.id, worker3, 60);
	assert.equal(claim3, null, "Third worker must be rejected while lease is held");
});

test("Phase 7 & 19: Heartbeat extends lease expiration for active worker", async () => {
	const run = await createPlatformRun({
		userId: testUserId,
		projectId: testProjectId,
		clientRequestId: `req_${crypto.randomUUID()}`,
		runtime: "AIRA_AGENT",
		budgets: DEFAULT_RUN_BUDGETS,
		tasks: [
			{
				key: "heartbeat-task",
				title: "Heartbeat extension task",
				objective: "Verify heartbeat renews lease",
				agentRole: "RESEARCH",
				modelTier: "reasoning",
				priority: 100,
				dependencies: [],
			},
		],
	});

	const task = (await listTasks(run.id))[0]!;
	const workerId = `worker:heartbeat:${crypto.randomUUID().slice(0, 6)}`;

	const claimed = await claimTask(task.id, workerId, 30);
	assert.ok(claimed);

	// Active owner can heartbeat and extend lease
	const renewed = await heartbeatTask(task.id, workerId, 120);
	assert.equal(renewed, true, "Active owner must be able to extend lease");

	// Non-owner cannot heartbeat
	const impostorWorker = `worker:impostor:${crypto.randomUUID().slice(0, 6)}`;
	const impostorRenewed = await heartbeatTask(task.id, impostorWorker, 120);
	assert.equal(impostorRenewed, false, "Impostor must not be able to extend lease");
});

test("Phase 7, 8, 21: Crashed worker recovery reclaims abandoned RUNNING task for retry", async () => {
	const run = await createPlatformRun({
		userId: testUserId,
		projectId: testProjectId,
		clientRequestId: `req_${crypto.randomUUID()}`,
		runtime: "AIRA_AGENT",
		budgets: { ...DEFAULT_RUN_BUDGETS, maxRetries: 2 },
		tasks: [
			{
				key: "crash-task-1",
				title: "Crash and recovery task",
				objective: "Verify crashed worker task is reclaimed",
				agentRole: "RESEARCH",
				modelTier: "reasoning",
				priority: 100,
				dependencies: [],
			},
		],
	});

	const task = (await listTasks(run.id))[0]!;
	const deadWorker = `worker:crashed:${crypto.randomUUID().slice(0, 6)}`;

	// 1. Worker claims task
	const claimed = await claimTask(task.id, deadWorker, 60);
	assert.ok(claimed);

	// 2. Create agent instance and transition to RUNNING
	const agentInstanceId = crypto.randomUUID();
	await prisma.$executeRaw`
		insert into "AgentInstance" ("id", "projectId", "runId", "role", "objective", "status", "modelTier", "allowedTools", "currentTaskId")
		values (${agentInstanceId}, ${testProjectId}, ${run.id}, 'RESEARCH', 'Test objective', 'IDLE', 'reasoning', '[]'::jsonb, ${task.id})
	`;
	const childRunId = crypto.randomUUID();
	await prisma.$executeRaw`
		insert into "AgentRun" ("id", "userId", "clientRequestId", "graphId", "graphVersion", "objective", "status", "provider", "updatedAt")
		values (${childRunId}, ${testUserId}, ${crypto.randomUUID()}, 'test-graph', 1, 'Objective', 'RUNNING', 'AIRA_AGENT', current_timestamp)
	`;

	await markTaskRunning(task.id, childRunId, agentInstanceId, 60);

	const runningTask = (await listTasks(run.id))[0]!;
	assert.equal(runningTask.status, "RUNNING");
	assert.equal(runningTask.leaseOwner, deadWorker);
	assert.ok(runningTask.leaseExpiresAt);

	// 3. Simulate worker process death and lease expiration
	await prisma.$executeRaw`
		update "AgentTask"
		set "leaseExpiresAt" = current_timestamp - interval '10 seconds'
		where "id" = ${task.id}
	`;

	// 4. Second worker runs claim recovery
	const recoveredCount = await recoverExpiredClaims(run.id);
	assert.equal(recoveredCount, 1, "Must recover exactly 1 expired task");

	// 5. Verify task is back in QUEUED with attempt count preserved
	const recoveredTask = (await listTasks(run.id))[0]!;
	assert.equal(recoveredTask.status, "QUEUED", "Task must be safely requeued");
	assert.equal(recoveredTask.leaseOwner, null, "Lease owner must be cleared");
	assert.equal(recoveredTask.leaseExpiresAt, null, "Lease expiration must be cleared");
	assert.ok(recoveredTask.lastError?.includes("Worker execution lease expired"), "Error message must record lease expiration");

	// 6. Verify orphaned agent instance is stopped and orphaned AgentRun is failed
	const instanceRows = await prisma.$queryRaw<Array<{ status: string }>>`
		select "status" from "AgentInstance" where "id"=${agentInstanceId}
	`;
	assert.equal(instanceRows[0]?.status, "STOPPED");

	const childRunRows = await prisma.$queryRaw<Array<{ status: string }>>`
		select "status" from "AgentRun" where "id"=${childRunId}
	`;
	assert.equal(childRunRows[0]?.status, "FAILED");

	// 7. A new live worker can now claim the recovered task and complete it
	const liveWorker = `worker:survivor:${crypto.randomUUID().slice(0, 6)}`;
	const reclaim = await claimTask(task.id, liveWorker, 60);
	assert.ok(reclaim, "Live worker must successfully claim recovered task");

	// Transition to running with live worker
	const liveChildRunId = crypto.randomUUID();
	await prisma.$executeRaw`
		insert into "AgentRun" ("id", "userId", "clientRequestId", "graphId", "graphVersion", "objective", "status", "provider", "updatedAt")
		values (${liveChildRunId}, ${testUserId}, ${crypto.randomUUID()}, 'test-graph', 1, 'Objective', 'RUNNING', 'AIRA_AGENT', current_timestamp)
	`;
	await prisma.$executeRaw`
		update "AgentInstance" set "status"='IDLE', "currentTaskId"=${task.id} where "id"=${agentInstanceId}
	`;
	await markTaskRunning(task.id, liveChildRunId, agentInstanceId, 60);
	await completeTask(task.id, ["artifact://run/result.md"]);

	const finalTask = (await listTasks(run.id))[0]!;
	assert.equal(finalTask.status, "COMPLETED");
	assert.equal(finalTask.leaseOwner, null);
});

test("Phase 8: Bounded retries mark task as FAILED when maxAttempts exceeded", async () => {
	const run = await createPlatformRun({
		userId: testUserId,
		projectId: testProjectId,
		clientRequestId: `req_${crypto.randomUUID()}`,
		runtime: "AIRA_AGENT",
		budgets: { ...DEFAULT_RUN_BUDGETS, maxRetries: 0 }, // maxAttempts = 1
		tasks: [
			{
				key: "no-retry-task",
				title: "No retry allowed task",
				objective: "Verify maxAttempts bounds",
				agentRole: "RESEARCH",
				modelTier: "reasoning",
				priority: 100,
				dependencies: [],
			},
		],
	});

	const task = (await listTasks(run.id))[0]!;
	assert.equal(task.maxAttempts, 1);

	const workerId = `worker:bound:${crypto.randomUUID().slice(0, 6)}`;
	await claimTask(task.id, workerId, 60);

	const instanceId = crypto.randomUUID();
	await prisma.$executeRaw`
		insert into "AgentInstance" ("id", "projectId", "runId", "role", "objective", "status", "modelTier", "allowedTools", "currentTaskId")
		values (${instanceId}, ${testProjectId}, ${run.id}, 'RESEARCH', 'Test', 'IDLE', 'reasoning', '[]'::jsonb, ${task.id})
	`;
	const childRunId2 = crypto.randomUUID();
	await prisma.$executeRaw`
		insert into "AgentRun" ("id", "userId", "clientRequestId", "graphId", "graphVersion", "objective", "status", "provider", "updatedAt")
		values (${childRunId2}, ${testUserId}, ${crypto.randomUUID()}, 'test-graph', 1, 'Objective', 'RUNNING', 'AIRA_AGENT', current_timestamp)
	`;
	await markTaskRunning(task.id, childRunId2, instanceId, 60);

	// Expire lease
	await prisma.$executeRaw`
		update "AgentTask" set "leaseExpiresAt" = current_timestamp - interval '5 seconds' where "id" = ${task.id}
	`;

	// Recover: because attempt (1) >= maxAttempts (1), it must transition to FAILED
	const recovered = await recoverExpiredClaims(run.id);
	assert.equal(recovered, 1);

	const failedTask = (await listTasks(run.id))[0]!;
	assert.equal(failedTask.status, "FAILED", "Task exceeding maxAttempts must transition to FAILED");
	assert.ok(failedTask.completedAt, "CompletedAt must be populated");
});

test("Phase 9: Cooperative cancellation terminates active work and records cancellation event", async () => {
	const run = await createPlatformRun({
		userId: testUserId,
		projectId: testProjectId,
		clientRequestId: `req_${crypto.randomUUID()}`,
		runtime: "AIRA_AGENT",
		budgets: DEFAULT_RUN_BUDGETS,
		tasks: [
			{
				key: "cancellable-task",
				title: "Cancellable task",
				objective: "Verify cancellation fence",
				agentRole: "RESEARCH",
				modelTier: "reasoning",
				priority: 100,
				dependencies: [],
			},
		],
	});

	// Cancel the managed run
	await cancelManagedRun(testUserId, run.id);

	const cancelledRun = await getRunForUser(testUserId, run.id);
	assert.equal(cancelledRun?.status, "CANCELLED");

	const tasks = await listTasks(run.id);
	assert.equal(tasks[0]?.status, "CANCELLED");
	assert.equal(tasks[0]?.leaseOwner, null);

	// Verify run.cancelled event was appended
	const events = await prisma.$queryRaw<Array<{ type: string }>>`
		select "type" from "AgentEvent" where "runId"=${run.id} and "type"='run.cancelled'
	`;
	assert.ok(events.length >= 1, "run.cancelled event must be recorded in durable store");
});

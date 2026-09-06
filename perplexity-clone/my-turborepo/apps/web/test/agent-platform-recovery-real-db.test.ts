import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
	ManagedTaskRecoveryError,
	reconcileBlockedManagedTask,
} from "@/lib/agent-platform/recovery";

const execFileAsync = promisify(execFile);
const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";
const STALE_SYNC_DATE = new Date(Date.now() - 10_000);

interface ProviderGate {
	readonly started: Promise<void>;
	readonly released: Promise<void>;
	markStarted(): void;
	release(): void;
}

function createGate(): ProviderGate {
	let markStarted!: () => void;
	let release!: () => void;
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { started, released, markStarted, release };
}

function setEnv(name: string, value: string): () => void {
	const previous = process.env[name];
	process.env[name] = value;
	return () => {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	};
}

test(
	"REAL_DB: blocked task recovery preserves identity, survives races/restart, and never creates a second runtime execution",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		let remoteStatus = "RUNNING";
		let getCount = 0;
		let postCount = 0;
		let nextGetGate: ProviderGate | null = null;

		const server = createServer(async (req, res) => {
			if (req.method === "POST") {
				postCount += 1;
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "recovery must never submit a new execution" }));
				return;
			}

			if (req.method === "GET" && req.url?.includes("/executions/") && req.url.endsWith("/results")) {
				getCount += 1;
				const gate = nextGetGate;
				if (gate) {
					nextGetGate = null;
					gate.markStarted();
					await gate.released;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ execution_id: "existing-exec", status: remoteStatus, output: null }));
				return;
			}

			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "unexpected test request" }));
		});

		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const providerUrl = `http://127.0.0.1:${address.port}`;

		const restoreEnv = [
			setEnv("NODE_ENV", "test"),
			setEnv("AUTOGPT_AGENT_ENABLED", "true"),
			setEnv("AUTOGPT_PRIMARY_API_BASE_URL", providerUrl),
			setEnv("AUTOGPT_PRIMARY_API_KEY", "real-db-test-key"),
			setEnv("AUTOGPT_GRAPH_ID", "graph-test"),
			setEnv("AUTOGPT_GRAPH_VERSION", "1"),
			setEnv("AUTOGPT_INPUT_NODE_ID", "input"),
			setEnv("AUTOGPT_REQUEST_TIMEOUT_MS", "5000"),
			setEnv("AUTOGPT_REQUIRE_FOUNDATION_STACK", "false"),
		];

		const suffix = randomUUID();
		const userId = `recovery-owner-${suffix}`;
		const attackerId = `recovery-attacker-${suffix}`;
		const projectId = `recovery-project-${suffix}`;
		const runId = `recovery-run-${suffix}`;
		const taskId = `recovery-task-${suffix}`;
		const agentRunId = `recovery-agent-run-${suffix}`;

		t.after(async () => {
			for (const restore of restoreEnv.reverse()) restore();
			await prisma.user.deleteMany({ where: { id: { in: [userId, attackerId] } } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});

		await prisma.user.createMany({
			data: [
				{ id: userId, email: `${userId}@example.test` },
				{ id: attackerId, email: `${attackerId}@example.test` },
			],
		});
		await prisma.agentRun.create({
			data: {
				id: agentRunId,
				userId,
				provider: "AUTOGPT",
				clientRequestId: `delegated-${suffix}`,
				remoteExecutionId: "existing-exec",
				graphId: "graph-test",
				graphVersion: 1,
				objective: "Recover the already-running delegated task.",
				status: AgentRunStatus.RUNNING,
				updatedAt: STALE_SYNC_DATE,
			},
		});
		await prisma.$executeRaw`
			insert into "AgentProject" ("id", "userId", "name", "objective", "config")
			values (${projectId}, ${userId}, 'Recovery real DB test', 'Prove durable recovery semantics.', '{}'::jsonb)
		`;
		await prisma.$executeRaw`
			insert into "AgentPlatformRun" (
				"id", "projectId", "userId", "clientRequestId", "status", "runtime", "budgets", "startedAt"
			) values (
				${runId}, ${projectId}, ${userId}, ${`managed-${suffix}`}, 'BLOCKED', 'AUTOGPT',
				${JSON.stringify({
					maxAgents: 13,
					maxParallelAgents: 1,
					maxToolCalls: 20,
					maxTokens: 100000,
					maxCostUsd: 10,
					maxDurationMinutes: 60,
					maxRetries: 1,
				})}::jsonb,
				current_timestamp
			)
		`;
		await prisma.$executeRaw`
			insert into "AgentTask" (
				"id", "projectId", "runId", "title", "objective", "status", "priority", "agentRole",
				"modelTier", "dependencies", "runtimeRunId", "attempt", "maxAttempts", "lastError", "startedAt"
			) values (
				${taskId}, ${projectId}, ${runId}, 'Recovery task', 'Continue existing remote work.', 'BLOCKED', 100,
				'RESEARCH', 'balanced', '[]'::jsonb, ${agentRunId}, 1, 2, 'unknown remote outcome', current_timestamp
			)
		`;

		async function resetScenario(options?: { attempt?: number; providerStatus?: string }): Promise<void> {
			remoteStatus = options?.providerStatus ?? "RUNNING";
			await prisma.agentRun.update({
				where: { id: agentRunId },
				data: {
					status: AgentRunStatus.RUNNING,
					updatedAt: new Date(Date.now() - 10_000),
					errorMessage: null,
					completedAt: null,
				},
			});
			await prisma.$executeRaw`
				update "AgentPlatformRun"
				set "status"='BLOCKED', "completedAt"=null, "updatedAt"=current_timestamp
				where "id"=${runId}
			`;
			await prisma.$executeRaw`
				update "AgentTask"
				set "status"='BLOCKED', "attempt"=${options?.attempt ?? 1}, "runtimeRunId"=${agentRunId},
					"lastError"='unknown remote outcome', "completedAt"=null, "updatedAt"=current_timestamp
				where "id"=${taskId}
			`;
			await prisma.$executeRaw`
				delete from "AgentEvent" where "runId"=${runId} and "type"='task.reconciled'
			`;
		}

		async function readTask(): Promise<{ status: string; attempt: number; runtimeRunId: string | null }> {
			const rows = await prisma.$queryRaw<Array<{ status: string; attempt: number; runtimeRunId: string | null }>>`
				select "status", "attempt", "runtimeRunId" from "AgentTask" where "id"=${taskId}
			`;
			assert.ok(rows[0]);
			return rows[0];
		}

		// Canonical same-attempt recovery: refresh the existing execution and never POST/create.
		await resetScenario();
		const canonical = await reconcileBlockedManagedTask({ userId, runId, taskId });
		assert.equal(canonical.outcome, "RECONCILED");
		assert.equal(canonical.reason, "existing_runtime_execution_reconciled");
		assert.equal(canonical.runtimeRunId, agentRunId);
		assert.equal(canonical.taskStatus, "RUNNING");
		assert.equal(canonical.runStatus, "RUNNING");
		assert.deepEqual(await readTask(), { status: "RUNNING", attempt: 1, runtimeRunId: agentRunId });
		const eventRows = await prisma.$queryRaw<Array<{ payload: { attempt?: number; runtimeRunId?: string } }>>`
			select "payload" from "AgentEvent" where "runId"=${runId} and "taskId"=${taskId} and "type"='task.reconciled'
		`;
		assert.equal(eventRows.length, 1);
		assert.equal(eventRows[0]?.payload.attempt, 1);
		assert.equal(eventRows[0]?.payload.runtimeRunId, agentRunId);
		assert.equal(postCount, 0);

		// Two recovery callers may refresh concurrently, but only one durable blocked->running transition wins.
		await resetScenario();
		const concurrent = await Promise.all([
			reconcileBlockedManagedTask({ userId, runId, taskId }),
			reconcileBlockedManagedTask({ userId, runId, taskId }),
		]);
		assert.equal(concurrent.filter((entry) => entry.outcome === "RECONCILED").length, 1);
		assert.equal(concurrent.filter((entry) => entry.outcome === "NOOP").length, 1);
		assert.deepEqual(await readTask(), { status: "RUNNING", attempt: 1, runtimeRunId: agentRunId });
		assert.equal(postCount, 0);

		// A stale recovery snapshot must not revive a newer attempt that changed while provider state was refreshing.
		await resetScenario({ attempt: 1 });
		const attemptGate = createGate();
		nextGetGate = attemptGate;
		const staleAttemptRecovery = reconcileBlockedManagedTask({ userId, runId, taskId });
		await attemptGate.started;
		await prisma.$executeRaw`
			update "AgentTask" set "attempt"=2, "updatedAt"=current_timestamp where "id"=${taskId}
		`;
		attemptGate.release();
		const staleAttemptResult = await staleAttemptRecovery;
		assert.equal(staleAttemptResult.outcome, "NOOP");
		assert.equal(staleAttemptResult.reason, "recovery_state_changed");
		assert.deepEqual(await readTask(), { status: "BLOCKED", attempt: 2, runtimeRunId: agentRunId });
		assert.equal(postCount, 0);

		// Cancellation wins if it commits while the provider refresh is in flight.
		await resetScenario();
		const cancelGate = createGate();
		nextGetGate = cancelGate;
		const cancellationRace = reconcileBlockedManagedTask({ userId, runId, taskId });
		await cancelGate.started;
		await prisma.$executeRaw`
			update "AgentPlatformRun" set "status"='CANCELLED', "completedAt"=current_timestamp, "updatedAt"=current_timestamp where "id"=${runId}
		`;
		await prisma.$executeRaw`
			update "AgentTask" set "status"='CANCELLED', "completedAt"=current_timestamp, "updatedAt"=current_timestamp where "id"=${taskId}
		`;
		cancelGate.release();
		const cancelled = await cancellationRace;
		assert.equal(cancelled.outcome, "NOOP");
		assert.equal(cancelled.reason, "recovery_state_changed");
		assert.equal(cancelled.runStatus, "CANCELLED");
		assert.equal(cancelled.taskStatus, "CANCELLED");
		assert.equal(postCount, 0);

		// REVIEW is explicitly non-authoritative and remains blocked for human/operator review.
		await resetScenario({ providerStatus: "REVIEW" });
		const review = await reconcileBlockedManagedTask({ userId, runId, taskId });
		assert.equal(review.outcome, "PENDING");
		assert.equal(review.reason, "runtime_review_pending");
		assert.equal(review.runtimeStatus, AgentRunStatus.REVIEW);
		assert.deepEqual(await readTask(), { status: "BLOCKED", attempt: 1, runtimeRunId: agentRunId });
		assert.equal(postCount, 0);

		// Cross-user reconciliation is denied before any provider call.
		await resetScenario();
		const getsBeforeUnauthorized = getCount;
		await assert.rejects(
			() => reconcileBlockedManagedTask({ userId: attackerId, runId, taskId }),
			(error: unknown) => error instanceof ManagedTaskRecoveryError && error.code === "NOT_FOUND",
		);
		assert.equal(getCount, getsBeforeUnauthorized);
		assert.equal(postCount, 0);

		// A brand-new Node process can recover from DB state only; no process-local claim/state is required.
		await resetScenario();
		const resolver = new URL("./resolver.mjs", import.meta.url).href;
		const childScript = fileURLToPath(new URL("./agent-platform-recovery-real-db-child.ts", import.meta.url));
		const child = await execFileAsync(
			process.execPath,
			["--import", resolver, childScript, userId, runId, taskId],
			{
				env: { ...process.env, DATABASE_POOL_MAX: "4" },
				timeout: 15_000,
				maxBuffer: 1024 * 1024,
			},
		);
		const childLines = child.stdout.trim().split(/\r?\n/).filter(Boolean);
		assert.ok(childLines.length > 0, child.stderr);
		const restarted = JSON.parse(childLines.at(-1)!) as { outcome: string; taskStatus: string; runStatus: string };
		assert.equal(restarted.outcome, "RECONCILED");
		assert.equal(restarted.taskStatus, "RUNNING");
		assert.equal(restarted.runStatus, "RUNNING");
		assert.deepEqual(await readTask(), { status: "RUNNING", attempt: 1, runtimeRunId: agentRunId });
		assert.equal(postCount, 0, "recovery must never issue a remote create/POST request");
		assert.ok(getCount >= 5, `expected provider refresh traffic, saw ${getCount} GET request(s)`);
	},
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AgentRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
	claimTask,
	completeTask,
	createPlatformRun,
	createProject,
	failTask,
	getRunByClientRequestId,
	listTasks,
	setTaskStatus,
	TaskClaimLostError,
} from "@/lib/agent-platform/store";
import { DEFAULT_RUN_BUDGETS, type TaskSpec } from "@/lib/agent-platform/types";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

function taskSpec(title: string): TaskSpec {
	return {
		key: title.toLowerCase().replaceAll(" ", "-"),
		title,
		objective: `Execute ${title} exactly once.`,
		agentRole: "RESEARCH",
		modelTier: "balanced",
		priority: 100,
		dependencies: [],
	};
}

async function seedRuntimeRun(input: {
	readonly id: string;
	readonly userId: string;
	readonly clientRequestId: string;
	readonly status: AgentRunStatus;
	readonly result: unknown;
}): Promise<void> {
	await prisma.agentRun.create({
		data: {
			id: input.id,
			userId: input.userId,
			provider: "AUTOGPT",
			clientRequestId: input.clientRequestId,
			remoteExecutionId: `remote-${input.id}`,
			graphId: "idempotency-test",
			graphVersion: 1,
			objective: "Idempotency real DB test",
			status: input.status,
			result: input.result as never,
			completedAt: new Date(),
		},
	});
}

test(
	"REAL_DB: duplicate mission creation, claims, completion and failure converge to one durable side effect",
	{ skip: !REAL_DB, timeout: 45_000 },
	async (t) => {
		const suffix = randomUUID();
		const userId = `idempotency-owner-${suffix}`;
		const projectName = `Idempotency ${suffix}`;
		await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const project = await createProject({
			userId,
			name: projectName,
			objective: "Prove duplicate execution safety.",
		});

		// Duplicate/double-click mission submissions with one clientRequestId must
		// create one managed run and one task graph only.
		const duplicateRequestId = randomUUID();
		const duplicateCreates = await Promise.allSettled([
			createPlatformRun({
				userId,
				projectId: project.id,
				clientRequestId: duplicateRequestId,
				runtime: "AUTOGPT",
				budgets: DEFAULT_RUN_BUDGETS,
				tasks: [taskSpec("Duplicate create")],
			}),
			createPlatformRun({
				userId,
				projectId: project.id,
				clientRequestId: duplicateRequestId,
				runtime: "AUTOGPT",
				budgets: DEFAULT_RUN_BUDGETS,
				tasks: [taskSpec("Duplicate create")],
			}),
		]);
		assert.equal(duplicateCreates.filter((entry) => entry.status === "fulfilled").length, 1);
		assert.equal(duplicateCreates.filter((entry) => entry.status === "rejected").length, 1);
		const duplicateRun = await getRunByClientRequestId(userId, duplicateRequestId);
		assert.ok(duplicateRun);
		assert.equal((await listTasks(duplicateRun.id)).length, 1);
		const duplicateRunCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
			select count(*)::bigint as "count" from "AgentPlatformRun"
			where "userId"=${userId} and "clientRequestId"=${duplicateRequestId}
		`;
		assert.equal(duplicateRunCount[0]?.count, 1n);

		// Two in-process workers racing the same queued task may produce one DB
		// claim only. A losing claimant must not erase the winning local fence.
		const claimTaskRow = (await listTasks(duplicateRun.id))[0]!;
		const claims = await Promise.all([
			claimTask(claimTaskRow.id, "worker-a", 90),
			claimTask(claimTaskRow.id, "worker-b", 90),
		]);
		assert.equal(claims.filter(Boolean).length, 1);
		const claimed = claims.find(Boolean)!;
		assert.ok(claimed.leaseOwner === "worker-a" || claimed.leaseOwner === "worker-b");
		await setTaskStatus(claimTaskRow.id, "CANCELLED");
		const cancelledClaim = (await listTasks(duplicateRun.id))[0]!;
		assert.equal(cancelledClaim.status, "CANCELLED");

		// Concurrent observers of one completed remote runtime must account usage,
		// artifacts and the RUNNING->COMPLETED transition exactly once.
		const completionRun = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: randomUUID(),
			runtime: "AUTOGPT",
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [taskSpec("Concurrent completion")],
		});
		const completionTask = (await listTasks(completionRun.id))[0]!;
		const completionRuntimeId = `completion-runtime-${suffix}`;
		await seedRuntimeRun({
			id: completionRuntimeId,
			userId,
			clientRequestId: `completion-${suffix}`,
			status: AgentRunStatus.COMPLETED,
			result: { usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 2, costUsd: 0.42 } },
		});
		await prisma.$executeRaw`
			update "AgentTask"
			set "status"='RUNNING', "runtimeRunId"=${completionRuntimeId}, "attempt"=1, "startedAt"=current_timestamp
			where "id"=${completionTask.id}
		`;

		const completions = await Promise.allSettled([
			completeTask(completionTask.id, ["artifact://result.json"]),
			completeTask(completionTask.id, ["artifact://result.json"]),
		]);
		assert.equal(completions.filter((entry) => entry.status === "fulfilled").length, 1);
		const completionLoser = completions.find((entry) => entry.status === "rejected");
		assert.ok(completionLoser?.status === "rejected" && completionLoser.reason instanceof TaskClaimLostError);

		const completedTask = (await listTasks(completionRun.id))[0]!;
		assert.equal(completedTask.status, "COMPLETED");
		const completionUsage = await prisma.$queryRaw<Array<{
			inputTokensUsed: bigint;
			outputTokensUsed: bigint;
			cachedTokensUsed: bigint;
			knownCostUsd: string;
		}>>`
			select "inputTokensUsed", "outputTokensUsed", "cachedTokensUsed", "knownCostUsd"::text as "knownCostUsd"
			from "AgentPlatformRun" where "id"=${completionRun.id}
		`;
		assert.deepEqual(completionUsage[0], {
			inputTokensUsed: 11n,
			outputTokensUsed: 7n,
			cachedTokensUsed: 2n,
			knownCostUsd: "0.42",
		});
		const artifactCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
			select count(*)::bigint as "count" from "AgentArtifact" where "taskId"=${completionTask.id}
		`;
		assert.equal(artifactCount[0]?.count, 1n);
		await assert.rejects(
			() => completeTask(completionTask.id, ["artifact://result.json"]),
			(error: unknown) => error instanceof TaskClaimLostError,
		);

		// The same terminal fence also protects definitive remote failures/retries
		// from double-counting provider usage under concurrent reconciliation.
		const failureRun = await createPlatformRun({
			userId,
			projectId: project.id,
			clientRequestId: randomUUID(),
			runtime: "AUTOGPT",
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [taskSpec("Concurrent failure")],
		});
		const failureTask = (await listTasks(failureRun.id))[0]!;
		const failureRuntimeId = `failure-runtime-${suffix}`;
		await seedRuntimeRun({
			id: failureRuntimeId,
			userId,
			clientRequestId: `failure-${suffix}`,
			status: AgentRunStatus.FAILED,
			result: { usage: { inputTokens: 5, outputTokens: 3, cachedTokens: 0, costUsd: 0.1 } },
		});
		await prisma.$executeRaw`
			update "AgentTask"
			set "status"='RUNNING', "runtimeRunId"=${failureRuntimeId}, "attempt"=1, "startedAt"=current_timestamp
			where "id"=${failureTask.id}
		`;
		const runningFailureTask = (await listTasks(failureRun.id))[0]!;
		const failures = await Promise.allSettled([
			failTask(runningFailureTask, "definitive runtime failure"),
			failTask(runningFailureTask, "definitive runtime failure"),
		]);
		assert.equal(failures.filter((entry) => entry.status === "fulfilled").length, 1);
		assert.equal(failures.filter((entry) => entry.status === "rejected").length, 1);
		const requeued = (await listTasks(failureRun.id))[0]!;
		assert.equal(requeued.status, "QUEUED");
		assert.equal(requeued.runtimeRunId, null);
		const failureUsage = await prisma.$queryRaw<Array<{
			inputTokensUsed: bigint;
			outputTokensUsed: bigint;
			knownCostUsd: string;
		}>>`
			select "inputTokensUsed", "outputTokensUsed", "knownCostUsd"::text as "knownCostUsd"
			from "AgentPlatformRun" where "id"=${failureRun.id}
		`;
		assert.deepEqual(failureUsage[0], {
			inputTokensUsed: 5n,
			outputTokensUsed: 3n,
			knownCostUsd: "0.1",
		});
	},
);

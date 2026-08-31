import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { cancelManagedRun } from "@/lib/agent-platform/orchestrator";
import {
	createPlatformRun,
	createProject,
	listTasks,
} from "@/lib/agent-platform/store";
import { DEFAULT_RUN_BUDGETS, type TaskSpec } from "@/lib/agent-platform/types";
import { prisma } from "@/lib/prisma";

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
				("id","clientRequestId","userId","projectId","runId","taskId","agentId","tool","action","risk","status","approvalId")
				values (${toolCallId},${`cancel-tool-request-${suffix}`},${userId},${project.id},${run.id},${task.id},${agentId},'web','open','HIGH','APPROVAL_REQUIRED',${approvalId})
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

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AgentRunStatus, UserMemoryKind } from "@/generated/prisma/enums";
import {
	claimBrowserActionLease,
	transitionBrowserControl,
} from "@/lib/agent-platform/browser-arbitration";
import {
	createBrowserSession,
	createPlatformRun,
	createProject,
	getBrowserSession,
	getProjectForUser,
	getRunByClientRequestId,
	getRunForUser,
	listBrowserActions,
	listBrowserSessions,
	listPendingApprovals,
	listProjectRuns,
	listProjects,
	listTasks,
	recordBrowserAction,
	resolveApproval,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import { DEFAULT_RUN_BUDGETS } from "@/lib/agent-platform/types";
import { getAgentRun, listAgentRuns } from "@/lib/autogpt/runs";
import {
	listToolApprovals,
	requestToolApproval,
	resolveToolApproval,
	ToolApprovalError,
} from "@/lib/agents/tool-approvals";
import { createKnowledgeAsset, updateKnowledgeAssetStatus } from "@/lib/knowledge-assets";
import { prisma } from "@/lib/prisma";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

test(
	"REAL_DB: current user-owned object graph rejects cross-user identifiers without mutation",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		const suffix = randomUUID();
		const ownerId = `idor-owner-${suffix}`;
		const attackerId = `idor-attacker-${suffix}`;
		const managedClientRequestId = `managed-idor-${suffix}`;
		const delegatedRunId = `delegated-idor-${suffix}`;
		const artifactRunId = `artifact-idor-${suffix}`;

		t.after(async () => {
			await prisma.user.deleteMany({ where: { id: { in: [ownerId, attackerId] } } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		await prisma.user.createMany({
			data: [
				{ id: ownerId, email: `${ownerId}@example.test` },
				{ id: attackerId, email: `${attackerId}@example.test` },
			],
		});

		const project = await createProject({
			userId: ownerId,
			name: "Owner-only project",
			objective: "Prove cross-user object identifiers remain inert.",
		});
		const managedRun = await createPlatformRun({
			userId: ownerId,
			projectId: project.id,
			clientRequestId: managedClientRequestId,
			runtime: null,
			budgets: DEFAULT_RUN_BUDGETS,
			tasks: [
				{
					key: "protected-task",
					title: "Protected task",
					objective: "Remain owned by the project user.",
					agentRole: "SECURITY",
					modelTier: "reasoning",
					priority: 100,
					dependencies: [],
					approval: { action: "protected test action", risk: "PROTECTED" },
				},
			],
		});
		const task = (await listTasks(managedRun.id))[0];
		assert.ok(task);

		const browser = await createBrowserSession({
			userId: ownerId,
			projectId: project.id,
			runId: managedRun.id,
			taskId: task.id,
			mode: "ASSISTED",
			allowedDomains: ["example.test"],
			permissions: ["navigate", "inspect"],
			ttlMinutes: 10,
		});
		await updateBrowserSession({ sessionId: browser.id, status: "ACTIVE" });
		await recordBrowserAction({
			sessionId: browser.id,
			source: "SYSTEM",
			action: "session.ready",
			result: { ready: true },
			risk: "LOW",
		});

		await prisma.agentRun.create({
			data: {
				id: delegatedRunId,
				userId: ownerId,
				provider: "AUTOGPT",
				clientRequestId: `delegated-client-${suffix}`,
				graphId: "graph-test",
				graphVersion: 1,
				objective: "Owner-only delegated work.",
				status: AgentRunStatus.RUNNING,
			},
		});
		const toolApproval = await requestToolApproval({
			userId: ownerId,
			runId: delegatedRunId,
			approvalKey: "owner-only-approval",
			toolId: "browser",
			permission: "WRITE",
			mode: "always_ask",
			summary: "Owner approval required.",
			request: { action: "click" },
		});
		await prisma.agentRun.create({
			data: {
				id: artifactRunId,
				userId: ownerId,
				provider: "DEERFLOW",
				clientRequestId: `artifact-client-${suffix}`,
				remoteExecutionId: `artifact-remote-${suffix}`,
				graphId: "deerflow",
				graphVersion: 1,
				objective: "Produce an owner-only artifact.",
				status: AgentRunStatus.COMPLETED,
				result: {
					threadId: "owner-thread",
					artifacts: ["mnt/user-data/outputs/owner-only.txt"],
				},
				completedAt: new Date(),
			},
		});

		// Projects, managed runs and their protected approval never cross owners.
		assert.equal((await getProjectForUser(ownerId, project.id))?.id, project.id);
		assert.equal(await getProjectForUser(attackerId, project.id), null);
		assert.equal((await listProjects(attackerId)).some((entry) => entry.id === project.id), false);
		assert.equal((await getRunForUser(ownerId, managedRun.id))?.id, managedRun.id);
		assert.equal(await getRunForUser(attackerId, managedRun.id), null);
		assert.equal(await getRunByClientRequestId(attackerId, managedClientRequestId), null);
		assert.equal((await listProjectRuns(attackerId, project.id)).length, 0);
		const platformApprovals = await listPendingApprovals(ownerId, managedRun.id);
		assert.equal(platformApprovals.length, 1);
		const platformApprovalId = String(platformApprovals[0]?.id ?? "");
		assert.ok(platformApprovalId);
		assert.equal(
			await resolveApproval({ userId: attackerId, approvalId: platformApprovalId, approve: true }),
			null,
		);
		assert.equal((await listPendingApprovals(ownerId, managedRun.id)).length, 1);

		// Browser reads, actions, control transitions and leases are all owner-scoped.
		assert.equal((await getBrowserSession(ownerId, browser.id))?.id, browser.id);
		assert.equal(await getBrowserSession(attackerId, browser.id), null);
		assert.equal((await listBrowserSessions(attackerId)).some((entry) => entry.id === browser.id), false);
		assert.equal((await listBrowserActions(attackerId, browser.id)).length, 0);
		assert.equal(
			await transitionBrowserControl({ userId: attackerId, sessionId: browser.id, control: "human" }),
			null,
		);
		assert.equal(
			await claimBrowserActionLease({
				userId: attackerId,
				sessionId: browser.id,
				source: "AGENT",
				leaseOwner: "attacker-worker",
			}),
			false,
		);
		const ownerBrowser = await getBrowserSession(ownerId, browser.id);
		assert.equal(ownerBrowser?.status, "ACTIVE");
		assert.equal((await listBrowserActions(ownerId, browser.id)).length, 1);

		// Delegated runs, tool approvals and artifact-bearing results remain invisible and inert.
		assert.equal((await getAgentRun(ownerId, delegatedRunId))?.id, delegatedRunId);
		assert.equal(await getAgentRun(attackerId, delegatedRunId), null);
		assert.equal(await getAgentRun(attackerId, artifactRunId), null);
		assert.equal((await listAgentRuns(attackerId, 50)).length, 0);
		assert.equal((await listToolApprovals(attackerId, delegatedRunId)).length, 0);
		await assert.rejects(
			() => requestToolApproval({
				userId: attackerId,
				runId: delegatedRunId,
				approvalKey: "attacker-approval",
				toolId: "browser",
				permission: "WRITE",
				mode: "always_ask",
				summary: "Must not attach to the owner's run.",
			}),
			(error: unknown) => error instanceof ToolApprovalError && error.code === "RUN_NOT_FOUND",
		);
		const eventsBefore = await prisma.agentRunEvent.count({ where: { runId: delegatedRunId } });
		await assert.rejects(
			() => resolveToolApproval(attackerId, delegatedRunId, toolApproval.id, "APPROVE"),
			(error: unknown) => error instanceof ToolApprovalError && error.code === "APPROVAL_NOT_FOUND",
		);
		const storedApproval = await prisma.agentToolApproval.findUnique({
			where: { id: toolApproval.id },
			select: { status: true, resolverUserId: true },
		});
		assert.deepEqual(storedApproval, { status: "PENDING", resolverUserId: null });
		assert.equal(await prisma.agentRunEvent.count({ where: { runId: delegatedRunId } }), eventsBefore);

		// KnowledgeAssets and callbacks enforce database-level user binding.
		const ownerAssetId = await createKnowledgeAsset({
			userId: ownerId,
			filename: "owner-secret.pdf",
			mimeType: "application/pdf",
			sizeBytes: 1024,
			sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			storageKey: `knowledge/${ownerId}/owner-secret.pdf`,
		});

		// Attacker attempting to update status of Owner's asset is rejected by raw SQL predicate
		await assert.rejects(
			() => updateKnowledgeAssetStatus({ assetId: ownerAssetId, userId: attackerId, status: "READY" }),
			(error: unknown) => error instanceof Error && error.message.includes("was not found for this user"),
		);

		// Verify Owner A asset remains strictly unchanged
		const [ownerAsset] = await prisma.$queryRaw<Array<{ status: string; errorMessage: string | null }>>`
			select status, "errorMessage" from public."KnowledgeAsset" where id = ${ownerAssetId} and "userId" = ${ownerId}
		`;
		assert.equal(ownerAsset?.status, "PROCESSING");
		assert.equal(ownerAsset?.errorMessage, null);

		// UserMemory entries are isolated per user.
		const memory = await prisma.userMemory.create({
			data: {
				userId: ownerId,
				content: "User prefers dark mode for all interface themes",
				kind: UserMemoryKind.PREFERENCE,
			},
		});
		assert.equal(
			await prisma.userMemory.findFirst({ where: { id: memory.id, userId: attackerId } }),
			null,
		);

		// McpServerPreference entries are isolated per (userId, serverId).
		await prisma.mcpServerPreference.upsert({
			where: { userId_serverId: { userId: ownerId, serverId: "github" } },
			create: { userId: ownerId, serverId: "github", enabled: true },
			update: { enabled: true },
		});
		assert.equal(
			await prisma.mcpServerPreference.findFirst({
				where: { userId: attackerId, serverId: "github" },
			}),
			null,
		);
	},
);

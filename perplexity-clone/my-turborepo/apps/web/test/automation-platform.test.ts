import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../lib/prisma";
import { globalAutomationEngine } from "../lib/automation/engine";
import { globalAutomationApprovalStore } from "../lib/automation/approvals";

const TEST_USER_IDS = [
	"user_auto_1",
	"user_auto_2",
	"user_approval_test",
	"user_routine_restart",
];

test.before(async () => {
	if (process.env.DATABASE_URL) {
		for (const id of TEST_USER_IDS) {
			await prisma.user.upsert({
				where: { id },
				update: {},
				create: { id, email: `${id}@test.local` },
			}).catch(() => undefined);
		}
	}
});

test.after(async () => {
	if (process.env.DATABASE_URL) {
		for (const id of TEST_USER_IDS) {
			await prisma.user.delete({ where: { id } }).catch(() => undefined);
		}
		await prisma.$disconnect().catch(() => undefined);
	}
});

test("Scheduled Routines & Visual DAG Workflow Validation (Gates 49, 116)", () => {
	const userId = "user_auto_1";

	const routine = globalAutomationEngine.createRoutine({
		userId,
		name: "Market Intelligence & Competitor Sync",
		description: "Periodically crawls market sentiment and prepares financial brief",
		enabled: true,
		budgetUsd: 10.0,
		trigger: {
			type: "cron",
			cronExpression: "0 9 * * 1-5",
			timezone: "America/New_York",
		},
		workflowDag: {
			id: "dag-market-intel",
			name: "Market Intel DAG",
			version: 1,
			description: "Linear automated research flow",
			nodes: [
				{ id: "trigger_node", type: "trigger", name: "Weekday 9am", config: {}, inputBindings: {} },
				{ id: "agent_node", type: "agent", name: "Financial Analyst", config: {}, inputBindings: {} },
				{ id: "export_node", type: "deliverable_export", name: "Report Exporter", config: {}, inputBindings: {} },
			],
			edges: [
				{ id: "e1", sourceNodeId: "trigger_node", targetNodeId: "agent_node" },
				{ id: "e2", sourceNodeId: "agent_node", targetNodeId: "export_node" },
			],
		},
	});

	assert.ok(routine.id.startsWith("routine-"));
	assert.equal(routine.name, "Market Intelligence & Competitor Sync");

	const validation = globalAutomationEngine.validateDAG(routine.workflowDag);
	assert.equal(validation.valid, true);
	assert.equal(validation.cycles, false);
	assert.deepEqual(validation.order, ["trigger_node", "agent_node", "export_node"]);
});

test("Workflow DAG Cycle Detection (Gate 116)", () => {
	const cyclicDAG = {
		id: "dag-cyclic",
		name: "Cyclic Flow",
		version: 1,
		description: "Illegal cycle",
		nodes: [
			{ id: "nodeA", type: "agent" as const, name: "A", config: {}, inputBindings: {} },
			{ id: "nodeB", type: "tool" as const, name: "B", config: {}, inputBindings: {} },
		],
		edges: [
			{ id: "e1", sourceNodeId: "nodeA", targetNodeId: "nodeB" },
			{ id: "e2", sourceNodeId: "nodeB", targetNodeId: "nodeA" },
		],
	};

	const res = globalAutomationEngine.validateDAG(cyclicDAG);
	assert.equal(res.valid, false);
	assert.equal(res.cycles, true);
});

test("Cross-Connector Execution & Notifications / Autonomous Work Inbox (Gates 108, 109, 110)", async () => {
	const userId = "user_auto_2";
	const routine = globalAutomationEngine.createRoutine({
		userId,
		name: "Cross-Connector Pipeline",
		enabled: true,
		trigger: { type: "manual" },
		workflowDag: {
			id: "dag-cross",
			name: "Gmail to Drive to Slack",
			version: 1,
			description: "Multi-connector orchestration",
			nodes: [
				{ id: "n1", type: "connector", name: "Gmail Read", config: { connector: "gmail", failurePolicy: "CONTINUE" }, inputBindings: {} },
				{ id: "n2", type: "connector", name: "Drive Save", config: { connector: "google_drive", failurePolicy: "CONTINUE" }, inputBindings: {} },
				{ id: "n3", type: "connector", name: "Slack Notify", config: { connector: "slack", failurePolicy: "CONTINUE" }, inputBindings: {} },
			],
			edges: [
				{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
				{ id: "e2", sourceNodeId: "n2", targetNodeId: "n3" },
			],
		},
	});

	const exec = await globalAutomationEngine.executeWorkflow(routine.id, userId);
	assert.equal(exec.status, "COMPLETED");
	assert.ok(exec.stepOutputs["n1"]);
	assert.ok(exec.stepOutputs["n2"]);
	assert.ok(exec.stepOutputs["n3"]);

	const notifications = globalAutomationEngine.getUserNotifications(userId);
	assert.ok(notifications.length >= 1);
	assert.ok(notifications[0]?.title.includes("Routine Completed"));
	assert.equal(notifications[0]?.read, false);

	const marked = globalAutomationEngine.markNotificationRead(userId, notifications[0]!.id);
	assert.equal(marked, true);
	assert.equal(globalAutomationEngine.getUserNotifications(userId)[0]?.read, true);
});

test("Workflow Template Gallery (Gate 114, 115)", () => {
	const templates = globalAutomationEngine.templates;
	assert.ok(templates.length >= 2);
	const leadTemplate = templates.find((t) => t.id === "template-lead-research-crm");
	assert.ok(leadTemplate);
	assert.ok(leadTemplate?.nodes.some((n) => n.type === "approval"));
});

test("Workflow Approval Fence: Pauses on Human Review and Resumes with Authorization (Gates 49, 108)", async () => {
	const userId = "user_approval_test";
	const routine = globalAutomationEngine.createRoutine({
		userId,
		name: "Regulated Financial Transfer Routine",
		description: "Requires explicit executive approval before executing write action",
		enabled: true,
		trigger: { type: "manual" },
		workflowDag: {
			id: "dag-approval-flow",
			name: "Approval Flow",
			version: 1,
			description: "Gated workflow",
			nodes: [
				{ id: "node_start", type: "trigger", name: "Start", config: {}, inputBindings: {} },
				{ id: "node_eval", type: "agent", name: "Risk Assessment Agent", config: { role: "RISK", failurePolicy: "CONTINUE" }, inputBindings: {} },
				{ id: "node_fence", type: "approval", name: "Compliance Approval Boundary", config: { prompt: "Approve transaction?" }, inputBindings: {} },
				{ id: "node_action", type: "tool", name: "Execute Transfer", config: { action: "transfer", failurePolicy: "CONTINUE" }, inputBindings: {} },
			],
			edges: [
				{ id: "e1", sourceNodeId: "node_start", targetNodeId: "node_eval" },
				{ id: "e2", sourceNodeId: "node_eval", targetNodeId: "node_fence" },
				{ id: "e3", sourceNodeId: "node_fence", targetNodeId: "node_action" },
			],
		},
	});

	const pausedRun = await globalAutomationEngine.executeWorkflow(routine.id, userId);
	assert.equal(pausedRun.status, "WAITING_APPROVAL");
	assert.equal(pausedRun.pendingApprovalNodeId, "node_fence");
	assert.ok(pausedRun.stepOutputs["node_start"]);
	assert.ok(pausedRun.stepOutputs["node_eval"]);
	assert.equal(pausedRun.stepOutputs["node_action"], undefined);

	const notifs = globalAutomationEngine.getUserNotifications(userId);
	assert.ok(notifs.some((n) => n.title.includes("Approval Required") && n.category === "approval"));

	assert.ok(pausedRun.pendingApprovalId);
	await globalAutomationApprovalStore.resolveApprovalAsync(pausedRun.pendingApprovalId, "APPROVE", userId);
	const approvedRun = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
		approvalId: pausedRun.pendingApprovalId,
		runId: pausedRun.id,
	});
	assert.equal(approvedRun.status, "COMPLETED");
	assert.ok(approvedRun.stepOutputs["node_action"]);
});

test("Automation Engine Durability: Routines and Runs Survive Restart (Gate 49 & Phase 12)", async () => {
	const userId = "user_routine_restart";
	const routine = globalAutomationEngine.createRoutine({
		userId,
		name: "Persistent Market Monitor",
		description: "Durable scheduled routine that survives server restart",
		enabled: true,
		trigger: { type: "cron", cronExpression: "0 10 * * *", timezone: "UTC" },
		workflowDag: {
			id: "dag-restart",
			name: "Restart DAG",
			version: 1,
			description: "Deterministic durability-only DAG with no external runtime dependency",
			nodes: [
				{ id: "n1", type: "trigger", name: "Cron", config: {}, inputBindings: {} },
			],
			edges: [],
		},
	});

	const run = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
		idempotencyKey: "idem_restart_key_1",
	});
	assert.equal(run.status, "COMPLETED");

	globalAutomationEngine.reloadFromDisk();

	const restoredRoutine = globalAutomationEngine.getRoutine(userId, routine.id);
	assert.notEqual(restoredRoutine, null);
	assert.equal(restoredRoutine?.name, "Persistent Market Monitor");

	const replayedRun = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
		idempotencyKey: "idem_restart_key_1",
	});
	assert.equal(replayedRun.id, run.id);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	evaluateRunAcceptance,
	VerificationResultSchema,
} from "../lib/agent-platform/orchestrator";
import type { PlatformRun, PlatformTask } from "../lib/agent-platform/types";

function mockRun(id = "run_test"): PlatformRun {
	return {
		id,
		projectId: "proj_test",
		userId: "usr_test",
		status: "RUNNING",
		clientRequestId: "req_test",
		runtime: "AIRA_AGENT",
		managerRole: "PRODUCT",
		budgets: {
			maxAgents: 4,
			maxParallelAgents: 2,
			maxToolCalls: 20,
			maxTokens: 100000,
			maxCostUsd: 10,
			maxDurationMinutes: 60,
			maxRetries: 2,
		},
		summary: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		startedAt: new Date(),
		completedAt: null,
	};
}

function mockTask(id: string, role: string, status: "COMPLETED" | "RUNNING" | "FAILED" = "COMPLETED"): PlatformTask {
	return {
		id,
		projectId: "proj_test",
		runId: "run_test",
		title: `${role} task`,
		objective: `Perform ${role}`,
		status,
		priority: 100,
		agentRole: role,
		modelTier: "reasoning",
		dependencies: [],
		inputArtifacts: [],
		outputArtifacts: [],
		runtimeRunId: `child_${id}`,
		attempt: 1,
		maxAttempts: 3,
		leaseOwner: null,
		leaseExpiresAt: null,
		heartbeatAt: null,
		lastError: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		startedAt: new Date(),
		completedAt: new Date(),
	};
}

test("evaluateRunAcceptance: rejects if not all tasks completed", async () => {
	const run = mockRun();
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "RESEARCH", "RUNNING"),
	];

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("Not all tasks"));
});

test("evaluateRunAcceptance: rejects if required deliverable artifact is missing", async () => {
	const run = mockRun();
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "RESEARCH", "COMPLETED"),
		mockTask("t3", "ARCHITECT", "COMPLETED"),
		mockTask("t4", "VERIFICATION", "COMPLETED"),
	];

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("deliverable artifact does not exist") || res.summary.includes("substantive content"));
});

test("evaluateRunAcceptance: rejects if deliverable artifact lacks substantive content", async () => {
	const run = mockRun("run_short_content");
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "VERIFICATION", "COMPLETED"),
	];

	// Create artifact with very short content
	const { createRunArtifact } = await import("../lib/agent-platform/store");
	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t1",
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "too short",
	});

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("substantive content"));
});

test("evaluateRunAcceptance: rejects if verification report is missing or invalid", async () => {
	const run = mockRun("run_no_verif");
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "VERIFICATION", "COMPLETED"),
	];

	const { createRunArtifact } = await import("../lib/agent-platform/store");
	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t1",
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "## Route Handlers Report\nThis is a substantive deliverable containing all factual documentation.",
	});

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("verification report"));
});

test("evaluateRunAcceptance: rejects if any required verification criterion failed", async () => {
	const run = mockRun("run_failed_crit");
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "VERIFICATION", "COMPLETED"),
	];

	const { createRunArtifact } = await import("../lib/agent-platform/store");
	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t1",
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "## Route Handlers Report\nThis is a substantive deliverable containing all factual documentation.",
	});

	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t2",
		kind: "VERIFICATION_REPORT",
		name: "verification_report.json",
		metadata: {
			criteria: [
				{ criterionId: "crit_1", passed: true, evidence: ["Citation A verified"] },
				{ criterionId: "crit_2", passed: false, evidence: ["Citation B failed to match"] },
			],
			requiredEvidencePresent: true,
			overallPassed: false,
			summary: "Failed due to criterion 2.",
		},
	});

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("failed") || res.summary.includes("not met"));
	assert.ok(res.failedCriteria?.includes("crit_2"));
});

test("evaluateRunAcceptance: passes when deliverable and all criteria with evidence are valid", async () => {
	const run = mockRun("run_full_pass");
	const tasks: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "VERIFICATION", "COMPLETED"),
	];

	const { createRunArtifact } = await import("../lib/agent-platform/store");
	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t1",
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "## Route Handlers Report\nThis is a substantive deliverable containing all factual documentation verified by evidence.",
	});

	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t2",
		kind: "VERIFICATION_REPORT",
		name: "verification_report.json",
		metadata: {
			criteria: [
				{ criterionId: "crit_1", passed: true, evidence: ["Citation A verified"] },
				{ criterionId: "crit_2", passed: true, evidence: ["Citation B verified"] },
			],
			requiredEvidencePresent: true,
			overallPassed: true,
			summary: "All criteria passed and verified.",
		},
	});

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, true);
	assert.ok(res.summary.includes("All criteria passed"));
});

test("VerificationResultSchema validates structured verification output", () => {
	const valid = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: ["Found citation on route handlers"] },
			{ criterionId: "c2", passed: true, evidence: ["Next.js documentation validated"] },
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "All criteria passed.",
	};
	const parsed = VerificationResultSchema.safeParse(valid);
	assert.ok(parsed.success);

	const invalidMissingEvidence = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: [] }, // empty evidence array
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Incomplete",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidMissingEvidence).success, false);

	const invalidMissingCriteria = {
		criteria: [],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Incomplete",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidMissingCriteria).success, false);
});

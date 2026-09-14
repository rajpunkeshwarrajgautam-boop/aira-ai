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

	// empty evidence array rejected
	const invalidMissingEvidence = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: [] },
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Incomplete",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidMissingEvidence).success, false);

	// empty criteria rejected
	const invalidMissingCriteria = {
		criteria: [],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Incomplete",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidMissingCriteria).success, false);

	// one criterion false + overallPassed=true MUST be rejected
	const invalidConflict = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: ["Valid evidence present"] },
			{ criterionId: "c2", passed: false, evidence: ["Failed to match expected pattern"] },
		],
		requiredEvidencePresent: true,
		overallPassed: true, // Conflict: overallPassed true when c2 is false
		summary: "Falsely claiming overall pass",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidConflict).success, false);

	// requiredEvidencePresent=false + overallPassed=true MUST be rejected
	const invalidNoEvidenceOverallPass = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: ["Valid evidence string"] },
		],
		requiredEvidencePresent: false,
		overallPassed: true,
		summary: "Falsely claiming overall pass without required evidence",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidNoEvidenceOverallPass).success, false);

	// generic placeholder evidence like "..." or "none" rejected
	const invalidPlaceholderEvidence = {
		criteria: [
			{ criterionId: "c1", passed: true, evidence: ["..."] },
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Placeholder evidence",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidPlaceholderEvidence).success, false);

	// plain text rejected
	assert.equal(VerificationResultSchema.safeParse("All acceptance criteria passed successfully.").success, false);

	// malformed JSON structure rejected
	assert.equal(VerificationResultSchema.safeParse({ criteria: "not-an-array", overallPassed: true }).success, false);

	// model refusal rejected
	assert.equal(VerificationResultSchema.safeParse({ refusal: "I cannot fulfill this verification request.", overallPassed: false }).success, false);
});

test("evaluateRunAcceptance: rejects when positive criterion relies on failed tool execution", async () => {
	const run = mockRun("run_failed_tool_ev");
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
		content: "## Substantive Deliverable\nContains complete analysis and facts.",
	});

	await createRunArtifact({
		projectId: run.projectId,
		runId: run.id,
		taskId: "t2",
		kind: "VERIFICATION_REPORT",
		name: "verification_report.json",
		metadata: {
			criteria: [
				{
					criterionId: "crit_api_audit",
					passed: true,
					evidence: ["Execution failed with status: FAILED on web search adapter."],
				},
			],
			requiredEvidencePresent: true,
			overallPassed: true,
			summary: "Claims pass based on failed tool observation.",
		},
	});

	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("relies on failed or unapproved tool execution"));
});

test("evaluateRunAcceptance: rejects fallback deliverable when treated as verification report", async () => {
	const run = mockRun("run_fallback_not_verif");
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
		content: "# Outcome Report\n## Execution Status\nPartial or reconstructed execution without independent verified completion.",
	});

	// No verification_report.json created because verification task produced only fallback deliverable
	const res = await evaluateRunAcceptance("usr_test", run, tasks);
	assert.equal(res.passed, false);
	assert.ok(res.summary.includes("verification report"));
});

test("evaluateRunAcceptance: verification provider timeout blocks Work completion and generates no pass", async () => {
	const run = mockRun("run_verif_timeout");
	// 1. Verification task timed out and ended in FAILED status
	const tasksFailedVerif: PlatformTask[] = [
		mockTask("t1", "PRODUCT", "COMPLETED"),
		mockTask("t2", "VERIFICATION", "FAILED"),
	];

	const resFailed = await evaluateRunAcceptance("usr_test", run, tasksFailedVerif);
	assert.equal(resFailed.passed, false);
	assert.ok(resFailed.summary.includes("Not all tasks"));

	// 2. Even if tasks were marked COMPLETED, but verification task timed out before writing verification_report.json
	const tasksNoReport: PlatformTask[] = [
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
		content: "## Complete Analysis\nThis is a substantive deliverable with facts.",
	});
	// No verification_report.json exists because timeout aborted writing it
	const resNoReport = await evaluateRunAcceptance("usr_test", run, tasksNoReport);
	assert.equal(resNoReport.passed, false);
	assert.ok(resNoReport.summary.includes("verification report"));
});

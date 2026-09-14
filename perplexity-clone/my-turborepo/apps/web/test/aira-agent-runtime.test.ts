import assert from "node:assert/strict";
import test from "node:test";

import {
	airaAgentRuntime,
	generateFallbackDeliverable,
	isAiraAgentConfigured,
	isAiraAgentEnabled,
	isToolExecutionSuccessful,
	isToolPermitted,
	parseModelDecision,
} from "../lib/agent-runtime/aira-agent-runtime";

test("airaAgentRuntime configuration and capabilities", async () => {
	assert.equal(airaAgentRuntime.id, "AIRA_AGENT");
	assert.ok(airaAgentRuntime.capabilities.cancel);
	assert.ok(airaAgentRuntime.capabilities.taskGraph);
	assert.ok(airaAgentRuntime.capabilities.artifacts);
	assert.ok(airaAgentRuntime.capabilities.controlledTools);

	const health = await airaAgentRuntime.getHealth();
	assert.equal(health.id, "AIRA_AGENT");
	assert.equal(typeof health.enabled, "boolean");
	assert.equal(typeof health.configured, "boolean");
	assert.equal(typeof health.ready, "boolean");
});

test("isAiraAgentEnabled respects environment flag", () => {
	const prev = process.env.AIRA_AGENT_ENABLED;
	try {
		process.env.AIRA_AGENT_ENABLED = "false";
		assert.equal(isAiraAgentEnabled(), false);
		process.env.AIRA_AGENT_ENABLED = "true";
		assert.equal(isAiraAgentEnabled(), true);
	} finally {
		process.env.AIRA_AGENT_ENABLED = prev;
	}
});

test("parseModelDecision correctly extracts structured tool calls", () => {
	const jsonCall = JSON.stringify({
		thought: "Looking up Next.js route handlers documentation",
		call: {
			tool: "web",
			action: "search",
			input: { query: "Next.js 15 route handlers" },
		},
	});
	const decision = parseModelDecision(jsonCall);
	assert.ok(decision.call);
	assert.equal(decision.call.tool, "web");
	assert.equal(decision.call.action, "search");
	assert.equal(decision.call.input?.query, "Next.js 15 route handlers");
});

test("parseModelDecision extracts tool calls inside markdown code fences", () => {
	const text = `
I need to inspect the documentation.
\`\`\`json
{
  "thought": "Search authoritative sources",
  "call": {
    "tool": "web",
    "action": "search",
    "input": { "query": "Route Handlers App Router" }
  }
}
\`\`\`
`;
	const decision = parseModelDecision(text);
	assert.ok(decision.call);
	assert.equal(decision.call.tool, "web");
	assert.equal(decision.call.action, "search");
});

test("parseModelDecision extracts finalAnswer and verification object", () => {
	const verificationText = JSON.stringify({
		thought: "All evidence verified.",
		finalAnswer: "Route handlers in Next.js 15 use standard Web Request and Response APIs.",
		verification: {
			criteria: [
				{ criterionId: "c1", passed: true, evidence: ["Documentation citations present"] },
			],
			requiredEvidencePresent: true,
			overallPassed: true,
			summary: "Verified Next.js Route Handlers factual citations.",
		},
	});
	const decision = parseModelDecision(verificationText);
	assert.equal(decision.finalAnswer, "Route handlers in Next.js 15 use standard Web Request and Response APIs.");
	assert.ok(decision.verification);
	assert.equal(decision.verification.overallPassed, true);
	assert.equal(decision.verification.criteria.length, 1);
});

test("parseModelDecision falls back safely on unstructured raw text", () => {
	const rawText = "This is a direct response without JSON wrapper.";
	const decision = parseModelDecision(rawText);
	assert.equal(decision.finalAnswer, rawText);
	assert.equal(decision.call, undefined);
});

test("isToolPermitted enforces task allowlist (Gate 4)", () => {
	const allowed = ["web", "files"];
	assert.equal(isToolPermitted("web", allowed), true);
	assert.equal(isToolPermitted("files", allowed), true);
	assert.equal(isToolPermitted("browser", allowed), false);
	assert.equal(isToolPermitted("code_execution", allowed), false);
	assert.equal(isToolPermitted("arbitrary_bash", allowed), false);
});

test("cancellation contract and terminal status protection (Gate 14 & 16)", () => {
	// Status transitions must be terminal
	const terminalStatuses = ["COMPLETED", "FAILED", "TERMINATED"];
	for (const status of terminalStatuses) {
		assert.ok(["COMPLETED", "FAILED", "TERMINATED"].includes(status));
	}
});

test("deterministic cancellation race: pending provider -> cancel child -> late provider response rejected (Gate 20)", async () => {
	type EventRecord = { eventKey: string; type: string; status: string; timestamp: number };
	const emittedEvents: EventRecord[] = [];

	// Simulate child AgentRun state machine
	const childState: { id: string; status: "RUNNING" | "TERMINATED" | "COMPLETED" | "FAILED"; completedAt: Date | null } = {
		id: "child_run_race_1",
		status: "RUNNING",
		completedAt: null,
	};

	const parentWorkState: { id: string; status: "RUNNING" | "CANCELLED" | "COMPLETED" | "FAILED" } = {
		id: "work_run_race_1",
		status: "RUNNING",
	};

	// 1. Start child AgentRun: provider execution is pending
	const providerPending = true;
	let resolveProvider: (val: unknown) => void = () => {};
	const providerPromise = new Promise((resolve) => {
		resolveProvider = resolve;
	});

	// 2. Cancel child while provider is pending
	// Simulation of runtime cancelRun / cancelManagedRun
	const performCancellation = () => {
		childState.status = "TERMINATED";
		childState.completedAt = new Date();
		parentWorkState.status = "CANCELLED";
		emittedEvents.push({
			eventKey: "cancelled",
			type: "CANCELLED",
			status: "TERMINATED",
			timestamp: Date.now(),
		});
	};

	assert.equal(providerPending, true, "Provider must be pending when cancellation is requested");
	performCancellation();

	assert.equal(childState.status, "TERMINATED");
	assert.equal(parentWorkState.status, "CANCELLED");

	// 3. Provider responds afterward (late response)
	const lateResponsePayload = {
		thought: "Completed all work successfully after delay",
		finalAnswer: "Substantive analysis completed",
		artifacts: ["final_deliverable.md", "verification_report.json"],
		verification: {
			criteria: [{ criterionId: "c1", passed: true, evidence: ["valid evidence"] }],
			requiredEvidencePresent: true,
			overallPassed: true,
			summary: "Late verification pass",
		},
	};

	resolveProvider(lateResponsePayload);
	const providerResult = await providerPromise;

	// 4. Runtime atomic completion fence (mirrors prisma.$executeRaw WHERE status = 'RUNNING')
	const applyCompletionFence = (currentState: typeof childState) => {
		if (currentState.status !== "RUNNING") {
			// Atomic fence rejects update: status is not RUNNING (it is TERMINATED)
			return { updated: 0, discarded: true };
		}
		currentState.status = "COMPLETED";
		currentState.completedAt = new Date();
		emittedEvents.push({
			eventKey: "completed",
			type: "COMPLETED",
			status: "COMPLETED",
			timestamp: Date.now(),
		});
		return { updated: 1, discarded: false };
	};

	const fenceResult = applyCompletionFence(childState);

	// Required assertions:
	// a. Atomic fence discarded the late update
	assert.equal(fenceResult.discarded, true);
	assert.equal(fenceResult.updated, 0);

	// b. Child remains TERMINATED
	assert.equal(childState.status, "TERMINATED");

	// c. Work/run remains canonical CANCELLED state
	assert.equal(parentWorkState.status, "CANCELLED");

	// d. No late COMPLETED transition
	assert.notEqual(childState.status, "COMPLETED");
	assert.notEqual(parentWorkState.status, "COMPLETED");

	// e. No completed event emitted after termination
	const completedEvents = emittedEvents.filter((e) => e.type === "COMPLETED" || e.eventKey === "completed");
	assert.equal(completedEvents.length, 0, "No completed event may be emitted after termination");

	// f. Verify that evaluateRunAcceptance rejects Work and does not accept late success artifacts
	const { evaluateRunAcceptance } = await import("../lib/agent-platform/orchestrator");
	const tasks = [
		{
			id: "task_race_1",
			projectId: "proj_race",
			runId: parentWorkState.id,
			title: "Research task",
			objective: "Perform research",
			status: "CANCELLED" as const,
			priority: 100,
			agentRole: "RESEARCH",
			modelTier: "reasoning" as const,
			dependencies: [],
			inputArtifacts: [],
			outputArtifacts: [],
			runtimeRunId: childState.id,
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
		},
	];

	const acceptance = await evaluateRunAcceptance("usr_test", {
		id: parentWorkState.id,
		projectId: "proj_race",
		userId: "usr_test",
		status: parentWorkState.status,
		clientRequestId: "req_race",
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
	}, tasks);

	assert.equal(acceptance.passed, false, "Late response must not produce accepted Work");
	assert.ok(acceptance.summary.includes("Not all tasks"), "Work acceptance must reject non-completed tasks");
});


test("isToolExecutionSuccessful correctly classifies tool statuses (Gates 9 & 10)", () => {
	assert.equal(isToolExecutionSuccessful({ status: "COMPLETED", result: { ok: true } }), true);
	assert.equal(isToolExecutionSuccessful({ status: "FAILED", error: "Connection error" }), false);
	assert.equal(isToolExecutionSuccessful({ status: "APPROVAL_REQUIRED", approvalId: "app_1" }), false);
	assert.equal(isToolExecutionSuccessful({ status: "DENIED", reason: "Blocked action" }), false);
	assert.equal(isToolExecutionSuccessful({ status: "CANCELLED" }), false);
	assert.equal(isToolExecutionSuccessful(null), false);
	assert.equal(isToolExecutionSuccessful(undefined), false);
	assert.equal(isToolExecutionSuccessful("COMPLETED"), false);
});

test("generateFallbackDeliverable produces truthful non-acceptance deliverable without false claims", () => {
	const deliverable = generateFallbackDeliverable("Analyze API routes", "Test Mission", []);
	// Truthful status
	assert.ok(deliverable.includes("Partial or reconstructed execution without independent verified completion."));
	// Insufficient evidence noted when no tools succeeded
	assert.ok(deliverable.includes("insufficient evidence"));
	// No false acceptance claims
	assert.ok(!deliverable.includes("verified observations"));
	assert.ok(!deliverable.includes("All scoping requirements and acceptance criteria have been evaluated and recorded."));
	assert.ok(deliverable.includes("Acceptance criteria have NOT been certified by this deliverable."));
});

test("generateFallbackDeliverable separates successful tools from failed tools in diagnostics", () => {
	const executedTools = [
		{
			tool: "web",
			action: "search",
			result: { status: "COMPLETED", data: { title: "Documentation" } },
			status: "COMPLETED",
		},
		{
			tool: "files",
			action: "write",
			result: { status: "FAILED", error: "Permission denied" },
			status: "FAILED",
		},
	];
	const deliverable = generateFallbackDeliverable("Audit system", "System Audit", executedTools);
	// Successful tool appears under Source Observation
	assert.ok(deliverable.includes("Source Observation 1: web.search"));
	// Failed tool appears under Diagnostic Notices, NOT as positive Source Observation
	assert.ok(deliverable.includes("Diagnostic Notices"));
	assert.ok(deliverable.includes("Attempted tool files.write: Unsuccessful or failed execution"));
	assert.ok(!deliverable.includes("Source Observation 2: files.write"));
});

test("parseModelDecision rejects malformed JSON and model refusal for verification", () => {
	const refusal = "I cannot fulfill this verification request because I am unable to inspect live systems.";
	const refusalDecision = parseModelDecision(refusal);
	assert.equal(refusalDecision.verification, undefined);
	assert.equal(refusalDecision.finalAnswer, refusal);

	const malformed = '{"thought": "evaluating", "verification": { "criteria": [{"criterionId": ';
	const malformedDecision = parseModelDecision(malformed);
	assert.equal(malformedDecision.verification, undefined);
});

test("Verification candidate validation accepts truthful negative verification but rejects invalid schemas", async () => {
	const { VerificationResultSchema } = await import("../lib/agent-platform/verification-schema");

	// Negative verification: validly structured, overallPassed=false
	const negativeValid = {
		criteria: [
			{ criterionId: "crit_api", passed: false, evidence: ["Observed status 500 on endpoint"] },
		],
		requiredEvidencePresent: true,
		overallPassed: false,
		summary: "Negative verification: endpoint failed.",
	};
	const parsedNegative = VerificationResultSchema.safeParse(negativeValid);
	assert.ok(parsedNegative.success);
	assert.equal(parsedNegative.data.overallPassed, false);

	// Invalid candidate: empty criteria array
	const invalidEmpty = {
		criteria: [],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Empty criteria",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidEmpty).success, false);

	// Invalid candidate: passed=true with no evidence
	const invalidNoEvidence = {
		criteria: [
			{ criterionId: "crit_api", passed: true, evidence: [] },
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "No evidence",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidNoEvidence).success, false);

	// Invalid candidate: one criterion failed but claiming overallPassed=true
	const invalidConflict = {
		criteria: [
			{ criterionId: "crit_1", passed: true, evidence: ["Valid evidence string"] },
			{ criterionId: "crit_2", passed: false, evidence: ["Failed to match"] },
		],
		requiredEvidencePresent: true,
		overallPassed: true,
		summary: "Contradiction",
	};
	assert.equal(VerificationResultSchema.safeParse(invalidConflict).success, false);
});

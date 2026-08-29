import assert from "node:assert/strict";
import test from "node:test";

import type { PublicToolDescriptor } from "../lib/tools/contracts";
import {
	AgentRuntimeBudgetError,
	AgentRuntimeLoopError,
	DEFAULT_EXECUTION_BUDGET,
	ExecutionMeter,
	parseExecutionPlan,
	parseVerificationResult,
	planObjective,
	roleCanUseTool,
	verifyOutcome,
} from "../lib/agent-runtime/index";
import type { PlannerModelRouter } from "../lib/agent-runtime/index";

function descriptor(permission: PublicToolDescriptor["permission"]): PublicToolDescriptor {
	return {
		id: `tool-${permission.toLowerCase()}`,
		label: permission,
		description: "test tool",
		category: "test",
		permission,
		sideEffecting: permission !== "READ",
		timeoutMs: 1_000,
		cancellable: false,
		audit: "standard",
		availability: { state: "AVAILABLE", detail: "test" },
	};
}

test("role policies enforce least privilege before canonical tool execution", () => {
	assert.equal(roleCanUseTool("researcher", descriptor("READ")), true);
	assert.equal(roleCanUseTool("researcher", descriptor("CODE_EXECUTION")), false);
	assert.equal(roleCanUseTool("coder", descriptor("CODE_EXECUTION")), true);
	assert.equal(roleCanUseTool("coder", descriptor("DESTRUCTIVE")), false);
	assert.equal(roleCanUseTool("browser_operator", descriptor("BROWSER_ACTION")), true);
	assert.equal(roleCanUseTool("verifier", descriptor("WRITE")), false);
});

test("execution meter stops tool-budget overflow and repeated action loops", () => {
	const toolMeter = new ExecutionMeter({
		...DEFAULT_EXECUTION_BUDGET,
		maxToolCalls: 2,
		maxEstimatedCostUsd: 100,
	}, 1_000);
	toolMeter.beforeToolCall("tool:a", 1_100);
	toolMeter.beforeToolCall("tool:b", 1_200);
	assert.equal(toolMeter.snapshot().toolCalls, 2);
	assert.throws(
		() => toolMeter.beforeToolCall("tool:c", 1_300),
		(error: unknown) => error instanceof AgentRuntimeBudgetError,
	);

	const loopMeter = new ExecutionMeter({
		...DEFAULT_EXECUTION_BUDGET,
		maxToolCalls: 10,
		maxRepeatedActions: 1,
		maxEstimatedCostUsd: 100,
	}, 1_000);
	loopMeter.beforeToolCall("browser:click:#submit", 1_100);
	assert.throws(
		() => loopMeter.beforeToolCall("browser:click:#submit", 1_200),
		(error: unknown) => error instanceof AgentRuntimeLoopError,
	);
});

test("planner parsing creates a dependency graph and always terminates in independent verification", () => {
	const plan = parseExecutionPlan(
		"Research a market and build a landing page",
		JSON.stringify({
			summary: "Research and build in parallel where possible.",
			tasks: [
				{
					id: "research-market",
					title: "Research market",
					description: "Collect evidence about the target market.",
					role: "researcher",
					dependsOn: [],
					priority: 80,
				},
				{
					id: "build-page",
					title: "Build landing page",
					description: "Implement the landing page after market research.",
					role: "coder",
					dependsOn: ["research-market"],
					priority: 70,
				},
			],
		}),
	);
	const verifier = plan.graph.tasks.find((task) => task.role === "verifier");
	assert.ok(verifier);
	assert.deepEqual(verifier.dependsOn, ["build-page"]);
	assert.equal(verifier.status, "pending");
});

test("planner can be exercised with a deterministic router without external providers", async () => {
	const router: PlannerModelRouter = {
		async *streamChat() {
			yield JSON.stringify({
				summary: "Analyze then verify.",
				tasks: [
					{
						id: "analyze",
						title: "Analyze input",
						description: "Perform the requested structured analysis.",
						role: "analyst",
						dependsOn: [],
						priority: 50,
					},
				],
			});
		},
	};
	const plan = await planObjective("Analyze this business", { router });
	assert.equal(plan.graph.tasks[0]?.role, "analyst");
	assert.equal(plan.graph.tasks.at(-1)?.role, "verifier");
});

test("verifier parser rejects contradictory PASS output", () => {
	assert.throws(() =>
		parseVerificationResult(JSON.stringify({
			verdict: "PASS",
			summary: "Looks good.",
			evidence: ["build passed"],
			failures: ["deployment is broken"],
			repairInstructions: [],
		})),
	);
});

test("verifier supports deterministic model injection and emits repairable failure", async () => {
	const router: PlannerModelRouter = {
		async *streamChat() {
			yield JSON.stringify({
				verdict: "FAIL",
				summary: "The form does not submit.",
				evidence: ["browser returned a validation error"],
				failures: ["submit flow is incomplete"],
				repairInstructions: ["wire the submit handler and rerun browser QA"],
			});
		},
	};
	const result = await verifyOutcome(
		{
			objective: "Build a working signup form",
			taskTitle: "Verify signup",
			workerResult: { claimed: "done" },
			observableEvidence: ["browser returned a validation error"],
		},
		{ router },
	);
	assert.equal(result.verdict, "FAIL");
	assert.equal(result.repairInstructions.length, 1);
});

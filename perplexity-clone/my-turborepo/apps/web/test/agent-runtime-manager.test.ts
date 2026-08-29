import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_EXECUTION_BUDGET,
	executeManagedTaskGraph,
	VerificationRepairRequest,
} from "../lib/agent-runtime/index";
import type {
	ManagerRuntimeObserver,
	RuntimeTask,
	RuntimeTaskExecutor,
	TaskGraph,
} from "../lib/agent-runtime/index";

function task(
	id: string,
	role: RuntimeTask["role"],
	dependsOn: readonly string[] = [],
	priority = 50,
): RuntimeTask {
	return {
		id,
		title: id,
		description: `Execute ${id}`,
		role,
		dependsOn,
		status: "pending",
		priority,
		attempt: 0,
		delegationDepth: 1,
	};
}

function workflowGraph(): TaskGraph {
	return {
		tasks: [
			task("research", "researcher", [], 80),
			task("analysis", "analyst", [], 70),
			task("build", "coder", ["research", "analysis"], 60),
			task("verify", "verifier", ["build"], 100),
		],
	};
}

test("manager executes independent DAG roots concurrently before dependent work", async () => {
	const schedulerStarts: string[][] = [];
	const observer: ManagerRuntimeObserver = {
		onSchedulerDecision(decision) {
			if (decision.startedTaskIds.length) schedulerStarts.push([...decision.startedTaskIds]);
		},
	};
	const executor: RuntimeTaskExecutor = {
		async execute({ task: current }) {
			return { output: `${current.id}:done` };
		},
	};

	const result = await executeManagedTaskGraph({
		objective: "Research, analyze, build and verify",
		graph: workflowGraph(),
		budget: { ...DEFAULT_EXECUTION_BUDGET, maxConcurrentAgents: 2 },
		executor,
		observer,
	});

	assert.equal(result.status, "completed");
	assert.deepEqual(schedulerStarts, [["research", "analysis"], ["build"], ["verify"]]);
	assert.ok(result.graph.tasks.every((entry) => entry.status === "completed"));
});

test("manager retries real task failures within the configured ceiling", async () => {
	let attempts = 0;
	const executor: RuntimeTaskExecutor = {
		async execute({ task: current }) {
			if (current.id === "research" && attempts++ === 0) throw new Error("transient provider failure");
			return { output: "ok" };
		},
	};
	const graph: TaskGraph = {
		tasks: [task("research", "researcher"), task("verify", "verifier", ["research"])],
	};

	const result = await executeManagedTaskGraph({
		objective: "Research then verify",
		graph,
		budget: { ...DEFAULT_EXECUTION_BUDGET, maxRetriesPerTask: 1 },
		executor,
	});

	assert.equal(result.status, "completed");
	assert.equal(result.graph.tasks.find((entry) => entry.id === "research")?.attempt, 2);
});

test("verifier repair request reopens worker work and invalidates stale downstream outputs", async () => {
	const counts = new Map<string, number>();
	const sawStaleBuildOutputDuringRepair: boolean[] = [];
	const executor: RuntimeTaskExecutor = {
		async execute({ task: current, outputs }) {
			const count = (counts.get(current.id) ?? 0) + 1;
			counts.set(current.id, count);
			if (current.id === "verify" && count === 1) {
				throw new VerificationRepairRequest(["build"], "Browser QA found a broken form.");
			}
			if (current.id === "build" && count === 2) {
				sawStaleBuildOutputDuringRepair.push(outputs.has("build"));
			}
			return { output: `${current.id}:attempt:${count}` };
		},
	};

	const result = await executeManagedTaskGraph({
		objective: "Build and verify",
		graph: workflowGraph(),
		budget: { ...DEFAULT_EXECUTION_BUDGET, maxConcurrentAgents: 2, maxRetriesPerTask: 2 },
		executor,
	});

	assert.equal(result.status, "completed");
	assert.equal(counts.get("build"), 2);
	assert.equal(counts.get("verify"), 2);
	assert.deepEqual(sawStaleBuildOutputDuringRepair, [false]);
	assert.equal(result.outputs.get("build")?.output, "build:attempt:2");
});

test("permanent worker failure blocks dependents instead of inventing completion", async () => {
	const executor: RuntimeTaskExecutor = {
		async execute({ task: current }) {
			if (current.id === "research") throw new Error("permanent failure");
			return { output: "unexpected" };
		},
	};
	const graph: TaskGraph = {
		tasks: [task("research", "researcher"), task("build", "coder", ["research"])],
	};

	const result = await executeManagedTaskGraph({
		objective: "Research then build",
		graph,
		budget: { ...DEFAULT_EXECUTION_BUDGET, maxRetriesPerTask: 0 },
		executor,
	});

	assert.equal(result.status, "failed");
	assert.deepEqual(result.failedTaskIds, ["research"]);
	assert.deepEqual(result.blockedTaskIds, ["build"]);
});

test("abort signal cancels unfinished work before dispatch", async () => {
	const controller = new AbortController();
	controller.abort();
	let executed = false;
	const executor: RuntimeTaskExecutor = {
		async execute() {
			executed = true;
			return { output: "unexpected" };
		},
	};
	const result = await executeManagedTaskGraph({
		objective: "Do not start",
		graph: { tasks: [task("research", "researcher")] },
		budget: DEFAULT_EXECUTION_BUDGET,
		executor,
		abortSignal: controller.signal,
	});
	assert.equal(result.status, "cancelled");
	assert.equal(executed, false);
	assert.equal(result.graph.tasks[0]?.status, "cancelled");
});

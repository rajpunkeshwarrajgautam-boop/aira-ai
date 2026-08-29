import assert from "node:assert/strict";
import test from "node:test";

import {
	createActionLoopGuardState,
	DEFAULT_EXECUTION_BUDGET,
	planSchedulerTick,
	reconcileTaskReadiness,
	registerActionFingerprint,
	requestTaskRetry,
	TaskGraphValidationError,
	validateTaskGraph,
} from "../lib/agent-runtime/index";
import type { ExecutionUsage, RuntimeTask, TaskGraph } from "../lib/agent-runtime/index";

function task(
	id: string,
	options: Partial<RuntimeTask> = {},
): RuntimeTask {
	return {
		id,
		title: options.title ?? id,
		role: options.role ?? "researcher",
		dependsOn: options.dependsOn ?? [],
		status: options.status ?? "pending",
		attempt: options.attempt ?? 0,
		delegationDepth: options.delegationDepth ?? 0,
		...(options.priority === undefined ? {} : { priority: options.priority }),
		...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
	};
}

function usage(overrides: Partial<ExecutionUsage> = {}): ExecutionUsage {
	return {
		startedAtMs: overrides.startedAtMs ?? 1_000,
		activeAgents: overrides.activeAgents ?? 0,
		toolCalls: overrides.toolCalls ?? 0,
		tokens: overrides.tokens ?? 0,
		estimatedCostUsd: overrides.estimatedCostUsd ?? 0,
	};
}

test("task graph rejects missing dependencies and cycles", () => {
	assert.throws(
		() => validateTaskGraph({ tasks: [task("build", { dependsOn: ["research"] })] }),
		(error: unknown) =>
			error instanceof TaskGraphValidationError && error.code === "MISSING_DEPENDENCY",
	);

	assert.throws(
		() =>
			validateTaskGraph({
				tasks: [
					task("a", { dependsOn: ["b"] }),
					task("b", { dependsOn: ["a"] }),
				],
			}),
		(error: unknown) =>
			error instanceof TaskGraphValidationError && error.code === "CYCLIC_DEPENDENCY",
	);
});

test("readiness and scheduler honor dependencies and bounded parallelism", () => {
	const graph: TaskGraph = {
		tasks: [
			task("research", { role: "researcher", priority: 10 }),
			task("analysis", { role: "analyst", priority: 8 }),
			task("build", { role: "coder", dependsOn: ["research", "analysis"] }),
		],
	};
	const budget = { ...DEFAULT_EXECUTION_BUDGET, maxConcurrentAgents: 2 };

	const first = planSchedulerTick({ graph, budget, usage: usage(), nowMs: 1_500 });
	assert.deepEqual(first.startedTaskIds, ["research", "analysis"]);
	assert.equal(first.graph.tasks.find((entry) => entry.id === "build")?.status, "pending");

	const afterWorkers: TaskGraph = {
		tasks: first.graph.tasks.map((entry) =>
			entry.id === "research" || entry.id === "analysis"
				? { ...entry, status: "completed" as const }
				: entry,
		),
	};
	const second = planSchedulerTick({ graph: afterWorkers, budget, usage: usage(), nowMs: 2_000 });
	assert.deepEqual(second.startedTaskIds, ["build"]);
	assert.equal(second.graph.tasks.find((entry) => entry.id === "build")?.attempt, 1);
});

test("failed dependencies block downstream work with an explicit reason", () => {
	const graph = reconcileTaskReadiness({
		tasks: [
			task("research", { status: "failed", attempt: 1 }),
			task("build", { dependsOn: ["research"] }),
		],
	});
	const build = graph.tasks.find((entry) => entry.id === "build");
	assert.equal(build?.status, "blocked");
	assert.match(build?.blockedReason ?? "", /research is failed/);
});

test("scheduler enforces delegation depth, retries, and global budgets", () => {
	const budget = {
		...DEFAULT_EXECUTION_BUDGET,
		maxDelegationDepth: 1,
		maxRetriesPerTask: 1,
		maxRuntimeMs: 1_000,
	};
	const deep = planSchedulerTick({
		graph: { tasks: [task("deep", { delegationDepth: 2 })] },
		budget,
		usage: usage(),
		nowMs: 1_500,
	});
	assert.deepEqual(deep.blockedTaskIds, ["deep"]);
	assert.equal(deep.graph.tasks[0]?.status, "blocked");

	const retryable = requestTaskRetry(
		{ tasks: [task("repair", { status: "failed", attempt: 1 })] },
		"repair",
		budget,
	);
	const retryTick = planSchedulerTick({
		graph: retryable,
		budget,
		usage: usage(),
		nowMs: 1_500,
	});
	assert.deepEqual(retryTick.startedTaskIds, ["repair"]);
	assert.equal(retryTick.graph.tasks[0]?.attempt, 2);

	const exhausted = requestTaskRetry(
		{ tasks: [task("repair", { status: "failed", attempt: 2 })] },
		"repair",
		budget,
	);
	assert.equal(exhausted.tasks[0]?.status, "failed");

	const timedOut = planSchedulerTick({
		graph: { tasks: [task("late")] },
		budget,
		usage: usage(),
		nowMs: 2_000,
	});
	assert.equal(timedOut.startedTaskIds.length, 0);
	assert.equal(timedOut.budgetViolations[0]?.limit, "runtime");
});

test("repeated action loop guard blocks execution beyond the configured threshold", () => {
	let state = createActionLoopGuardState(3);
	for (let index = 0; index < 3; index += 1) {
		const result = registerActionFingerprint(state, "browser:click:#submit");
		state = result.state;
		assert.equal(result.blocked, false);
	}
	const fourth = registerActionFingerprint(state, "browser:click:#submit");
	assert.equal(fourth.blocked, true);
	assert.equal(fourth.count, 4);
});

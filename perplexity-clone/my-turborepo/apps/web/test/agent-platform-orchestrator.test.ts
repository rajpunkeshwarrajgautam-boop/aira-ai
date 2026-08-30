import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	buildManagerDag,
	runtimeAttemptRequestId,
	runtimeSubmissionOutcomeUnknown,
} from "../lib/agent-platform/orchestrator";
import { DEFAULT_RUN_BUDGETS } from "../lib/agent-platform/types";
import {
	getBrowserRuntimeConfig,
	isBrowserRuntimeEnabled,
} from "../lib/browser-runtime/client";

function assertDag(tasks: ReturnType<typeof buildManagerDag>) {
	const keys = new Set(tasks.map((task) => task.key));
	assert.equal(keys.size, tasks.length, "task keys must be unique");
	for (const task of tasks) {
		for (const dependency of task.dependencies) {
			assert.ok(keys.has(dependency), `${task.key} depends on unknown task ${dependency}`);
			assert.notEqual(dependency, task.key, "a task cannot depend on itself");
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byKey = new Map(tasks.map((task) => [task.key, task]));
	function visit(key: string) {
		if (visited.has(key)) return;
		assert.ok(!visiting.has(key), `cycle detected at ${key}`);
		visiting.add(key);
		for (const dependency of byKey.get(key)?.dependencies ?? []) visit(dependency);
		visiting.delete(key);
		visited.add(key);
	}
	for (const task of tasks) visit(task.key);
}

test("managed build DAG preserves QA and independent verification", () => {
	const tasks = buildManagerDag("Build a production-ready CRM application");
	assert.equal(tasks.length, 12);
	assertDag(tasks);
	const verification = tasks.find((task) => task.key === "verification");
	assert.deepEqual(verification?.dependencies, ["browser-qa"]);
	assert.ok(tasks.some((task) => task.key === "security"));
	assert.ok(tasks.some((task) => task.key === "qa"));
	assert.ok(tasks.some((task) => task.key === "browser-qa"));
});

test("deployment missions create a high-risk human approval gate", () => {
	const tasks = buildManagerDag("Build the app and deploy it to production on Vercel");
	assert.equal(tasks.length, 13);
	assertDag(tasks);
	const deployment = tasks.find((task) => task.key === "deployment");
	assert.equal(deployment?.approval?.risk, "HIGH");
	assert.equal(deployment?.approval?.action, "production deployment");
	assert.deepEqual(deployment?.dependencies, ["browser-qa"]);
	assert.deepEqual(tasks.find((task) => task.key === "verification")?.dependencies, ["deployment"]);
});

test("default mission budget cannot silently truncate the production DAG", () => {
	const productionTasks = buildManagerDag("ship this application to production");
	assert.ok(DEFAULT_RUN_BUDGETS.maxAgents >= productionTasks.length);
	assert.ok(DEFAULT_RUN_BUDGETS.maxParallelAgents < DEFAULT_RUN_BUDGETS.maxAgents);
});

test("managed mission creation uses request-bound quota and does not refund a concurrent winner", () => {
	const source = readFileSync(new URL("../lib/agent-platform/orchestrator.ts", import.meta.url), "utf8");
	assert.match(source, /consumeManagedMissionQuota\(input\.userId, input\.clientRequestId\)/);
	assert.doesNotMatch(source, /consumeAgentRunQuota\(/);
	const concurrent = source.indexOf("const concurrent = await getRunByClientRequestId", source.indexOf("export async function startManagedRun"));
	const concurrentReturn = source.indexOf("if (concurrent) return tickManagedRun", concurrent);
	const refund = source.indexOf("refundManagedMissionQuota(input.userId, input.clientRequestId)", concurrent);
	assert.ok(concurrent >= 0 && concurrentReturn > concurrent && refund > concurrentReturn, "a losing concurrent creator must reuse the winner before any quota refund");
});

test("delegated runtime retries use deterministic attempt-scoped idempotency identities", () => {
	assert.equal(runtimeAttemptRequestId({ id: "task-1", attempt: 0 }), "task-1", "first attempt preserves the historical crash-recovery key");
	assert.equal(runtimeAttemptRequestId({ id: "task-1", attempt: 1 }), "task-1:attempt:2");
	assert.equal(runtimeAttemptRequestId({ id: "task-1", attempt: 2 }), "task-1:attempt:3");
});

test("runtime submission ambiguity is explicit and fail-closed", () => {
	assert.equal(runtimeSubmissionOutcomeUnknown({ submissionOutcomeUnknown: true }), true);
	assert.equal(runtimeSubmissionOutcomeUnknown({ submissionOutcomeUnknown: false }), false);
	assert.equal(runtimeSubmissionOutcomeUnknown(new Error("ordinary failure")), false);
	assert.equal(runtimeSubmissionOutcomeUnknown(null), false);
});

test("orchestrator blocks unknowable runtime outcomes and only retries known failures", () => {
	const source = readFileSync(new URL("../lib/agent-platform/orchestrator.ts", import.meta.url), "utf8");
	assert.match(source, /clientRequestId:\s*runtimeRequestId/);
	assert.match(source, /billingMode:\s*"DELEGATED"/);
	assert.match(source, /consumeClaimedDispatchAttempt\(claimed\)/);
	assert.match(source, /reasonCode:\s*"runtime_outcome_unknown"/);
	assert.match(source, /reasonCode:\s*"runtime_link_missing"/);
	assert.match(source, /reasonCode:\s*"runtime_run_missing"/);
	assert.match(source, /reasonCode:\s*"runtime_refresh_missing"/);
	assert.match(source, /risks:\s*\["duplicate_execution"\]/);
	assert.doesNotMatch(source, /clientRequestId:\s*task\.id,\s*\n\s*objective:\s*runtimeContext\.systemPrompt/);
});

test("uncertain linkage preserves the same attempt identity instead of advancing", () => {
	const source = readFileSync(new URL("../lib/agent-platform/orchestrator.ts", import.meta.url), "utf8");
	assert.match(source, /select:\s*\{ id: true, status: true \}/);
	assert.match(source, /taskState\?\.status === "RUNNING" && taskState\.runtimeRunId === attemptRun\.id/);
	assert.match(source, /reason:\s*"runtime_link_already_committed"/);
	assert.match(source, /AgentRunStatus\.FAILED, AgentRunStatus\.TERMINATED/);
	assert.match(source, /consumeAttempt:\s*false/);
	assert.match(source, /type:\s*"task\.recovery_pending"/);
	assert.match(source, /runtimeClientRequestId:\s*runtimeRequestId/);
	assert.match(source, /Keeping the attempt counter unchanged guarantees/);
});

test("browser runtime remains disabled unless explicitly enabled", () => {
	const previous = process.env.AIRA_BROWSER_RUNTIME_ENABLED;
	try {
		delete process.env.AIRA_BROWSER_RUNTIME_ENABLED;
		assert.equal(isBrowserRuntimeEnabled(), false);
		process.env.AIRA_BROWSER_RUNTIME_ENABLED = "true";
		assert.equal(isBrowserRuntimeEnabled(), true);
	} finally {
		if (previous === undefined) delete process.env.AIRA_BROWSER_RUNTIME_ENABLED;
		else process.env.AIRA_BROWSER_RUNTIME_ENABLED = previous;
	}
});

test("browser runtime rejects credential-bearing URLs", () => {
	const previousUrl = process.env.AIRA_BROWSER_RUNTIME_URL;
	const previousToken = process.env.AIRA_BROWSER_RUNTIME_TOKEN;
	try {
		process.env.AIRA_BROWSER_RUNTIME_URL = "https://user:secret@browser.example.com";
		process.env.AIRA_BROWSER_RUNTIME_TOKEN = "contract-test-token";
		assert.throws(() => getBrowserRuntimeConfig(), /credentials/i);
	} finally {
		if (previousUrl === undefined) delete process.env.AIRA_BROWSER_RUNTIME_URL;
		else process.env.AIRA_BROWSER_RUNTIME_URL = previousUrl;
		if (previousToken === undefined) delete process.env.AIRA_BROWSER_RUNTIME_TOKEN;
		else process.env.AIRA_BROWSER_RUNTIME_TOKEN = previousToken;
	}
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildManagerDag } from "../lib/agent-platform/orchestrator";
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

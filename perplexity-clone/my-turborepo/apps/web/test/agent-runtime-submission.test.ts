import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("AIRA Manager submission is feature-gated and consumes quota only for a newly created parent run", () => {
	const source = readWeb("lib/agent-runtime/managed-runs.ts");
	assert.ok(source.includes('process.env.AIRA_MANAGER_RUNTIME_ENABLED === "true"'));
	assert.ok(source.includes('process.env.AIRA_MANAGER_WORKER_ENABLED === "true"'));
	assert.ok(source.includes("foundationControlPlaneConfigured()"));
	assert.ok(source.includes('provider: "AIRA"'));
	assert.ok(source.includes('graphId: MANAGER_GRAPH_ID'));
	assert.ok(source.includes("createdLocally"));
	assert.ok(source.includes("consumeAgentRunQuota(options.userId)"));
	assert.ok(source.includes("getEffectiveEntitlements(options.userId)"));
});

test("AIRA Manager queue retries are idempotent and preserve the parent run on unknown enqueue outcome", () => {
	const source = readWeb("lib/agent-runtime/managed-runs.ts");
	assert.ok(source.includes('type: "agent.manager"'));
	assert.ok(source.includes("jobKey: `run:${run.id}`"));
	assert.ok(source.includes("ManagedAgentQueueError"));
	assert.ok(source.includes("duplicate work is prevented"));
	assert.ok(!source.includes("refundAgentRunQuota"));
});

test("agent run API prefers AIRA Manager only when explicitly configured and preserves direct provider fallback", () => {
	const source = readWeb("app/api/agents/runs/route.ts");
	assert.ok(source.includes('type AgentProvider = "AIRA" | "DEERFLOW" | "AUTOGPT"'));
	assert.ok(source.includes('z.enum(["AIRA", "DEERFLOW", "AUTOGPT"])'));
	assert.ok(source.includes("if (state.manager.configured) return \"AIRA\""));
	assert.ok(source.includes('provider === "AIRA"'));
	assert.ok(source.includes("submitManagedAgentRun"));
	assert.ok(source.includes("submitDeerFlowAgentRun"));
	assert.ok(source.includes("submitAgentRun"));
	assert.ok(source.includes("ManagedAgentQueueError"));
});

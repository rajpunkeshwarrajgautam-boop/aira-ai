import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function readRepo(relative: string): string {
	return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

test("background reconciler only refreshes existing active runs with bounded work", () => {
	const source = readWeb("lib/agents/run-reconciler.ts");

	assert.ok(source.includes("AgentRunStatus.QUEUED"));
	assert.ok(source.includes("AgentRunStatus.RUNNING"));
	assert.ok(source.includes("AgentRunStatus.REVIEW"));
	assert.ok(source.includes('orderBy: { updatedAt: "asc" }'));
	assert.ok(source.includes("take: config.batchSize"));
	assert.ok(source.includes("MAX_BATCH_SIZE = 25"));
	assert.ok(source.includes("MAX_CONCURRENCY = 6"));
	assert.ok(source.includes("reconcileWithBoundedConcurrency"));
	assert.ok(source.includes("refreshDeerFlowAgentRun"));
	assert.ok(source.includes("refreshAgentRun"));
	assert.ok(!source.includes("createDeerFlowRun"));
	assert.ok(!source.includes("executeAutoGptGraph"));
	assert.ok(!source.includes("submitAgentRun"));
	assert.ok(!source.includes("submitDeerFlowAgentRun"));
});

test("reconciliation endpoint is token-protected, POST-only and returns aggregate state", () => {
	const route = readWeb("app/api/internal/agents/reconcile/route.ts");

	assert.ok(route.includes('from "node:crypto"'));
	assert.ok(route.includes("timingSafeEqual"));
	assert.ok(route.includes("AIRA_AGENT_RECONCILER_TOKEN"));
	assert.ok(route.includes('authorization?.startsWith("Bearer ")'));
	assert.ok(route.includes("export async function POST"));
	assert.ok(!route.includes("export async function GET"));
	assert.ok(route.includes('"Cache-Control": "no-store"'));
	assert.ok(route.includes("reconcileActiveAgentRuns()"));
	assert.ok(route.includes("{ ok: true, summary }"));
	assert.ok(!route.includes("runId:"));
	assert.ok(!route.includes("userId:"));
});

test("Hobby deployment does not pretend a frequent Vercel cron exists", () => {
	const vercel = JSON.parse(readRepo("vercel.json")) as Record<string, unknown>;
	const env = readRepo(".env.example");

	assert.equal("crons" in vercel, false);
	assert.ok(env.includes("AIRA_AGENT_RECONCILER_TOKEN="));
	assert.ok(env.includes("AIRA_AGENT_RECONCILE_BATCH_SIZE=20"));
	assert.ok(env.includes("AIRA_AGENT_RECONCILE_CONCURRENCY=4"));
	assert.ok(env.includes("AIRA_AGENT_RECONCILE_MIN_AGE_MS=5000"));
	assert.ok(env.includes("Hobby cron is daily-only"));
});

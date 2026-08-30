import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recoverySource = readFileSync(new URL("../lib/agent-platform/recovery.ts", import.meta.url), "utf8");
const routeSource = readFileSync(
	new URL("../app/api/agent-platform/runs/[runId]/tasks/[taskId]/reconcile/route.ts", import.meta.url),
	"utf8",
);

test("blocked task reconciliation refreshes only the existing runtime execution", () => {
	assert.match(recoverySource, /where:\s*\{ id: task\.runtimeRunId, userId: input\.userId \}/);
	assert.match(recoverySource, /runtime\.refreshRun\(input\.userId, local\.id\)/);
	assert.match(recoverySource, /child\.id !== task\.runtimeRunId/);
	assert.doesNotMatch(recoverySource, /\.createRun\(/);
	assert.doesNotMatch(recoverySource, /runtimeAttemptRequestId/);
});

test("ambiguous reconciliation remains fail-closed and never advances the attempt", () => {
	assert.match(recoverySource, /reason:\s*"runtime_link_missing"/);
	assert.match(recoverySource, /reason:\s*"runtime_run_missing"/);
	assert.match(recoverySource, /reason:\s*"runtime_refresh_failed"/);
	assert.match(recoverySource, /reason:\s*"runtime_refresh_missing"/);
	assert.match(recoverySource, /reason:\s*"runtime_identity_mismatch"/);
	assert.match(recoverySource, /child\.status === AgentRunStatus\.REVIEW/);
	assert.match(recoverySource, /reason:\s*"runtime_review_pending"/);
	assert.doesNotMatch(recoverySource, /"attempt"\s*=\s*"attempt"\s*\+\s*1/);
});

test("reconciliation serializes with cancellation and guards the exact blocked task identity", () => {
	assert.match(recoverySource, /from "AgentPlatformRun"[\s\S]*?for update/);
	assert.match(recoverySource, /parentStatus !== "BLOCKED" && parentStatus !== "RUNNING"/);
	assert.match(recoverySource, /and "runId"=\$\{run\.id\}/);
	assert.match(recoverySource, /and "projectId"=\$\{run\.projectId\}/);
	assert.match(recoverySource, /and "status"='BLOCKED'/);
	assert.match(recoverySource, /and "runtimeRunId"=\$\{task\.runtimeRunId\}/);
	assert.match(recoverySource, /set "status"='RUNNING', "lastError"=null/);
});

test("authoritative reconciliation re-enters canonical task processing rather than duplicating terminal logic", () => {
	assert.match(recoverySource, /type:\s*"task\.reconciled"/);
	assert.match(recoverySource, /runtimeStatus:\s*child\.status/);
	assert.match(recoverySource, /await tickManagedRun\(input\.userId, run\.id\)/);
});

test("reconciliation route is authenticated and derives ownership only from the session", () => {
	assert.match(routeSource, /const session = await auth\(\)/);
	assert.match(routeSource, /if \(!session\?\.user\?\.id\)/);
	assert.match(routeSource, /userId:\s*session\.user\.id/);
	assert.match(routeSource, /runId,/);
	assert.match(routeSource, /taskId,/);
	assert.doesNotMatch(routeSource, /req\.json/);
	assert.doesNotMatch(routeSource, /userId:\s*parsed/);
});

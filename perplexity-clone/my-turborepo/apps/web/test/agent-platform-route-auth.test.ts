import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

test("HTTP Route Auth Contract: AgentTask steer route enforces auth session and owner task resolution", () => {
	const source = readWeb("app/api/agent-platform/runs/[runId]/tasks/[taskId]/steer/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("SteerSchema.safeParse"));
	assert.ok(source.includes("steerManagedTask("));
	assert.ok(source.includes("session.user.id"));
	assert.ok(source.includes("TASK_STEER_FAILED"));
});

test("HTTP Route Auth Contract: AgentTask reconcile route enforces auth session and owner task resolution", () => {
	const source = readWeb("app/api/agent-platform/runs/[runId]/tasks/[taskId]/reconcile/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("reconcileBlockedManagedTask("));
	assert.ok(source.includes("session.user.id"));
	assert.ok(source.includes("TASK_RECONCILE_FAILED"));
});

test("HTTP Route Auth Contract: AgentPlatformRun cancel route enforces auth session and getRunForUser check before cancellation", () => {
	const source = readWeb("app/api/agent-platform/runs/[runId]/cancel/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("getRunForUser(session.user.id, runId)"));
	assert.ok(source.includes("cancelManagedRun(session.user.id, runId)"));
	assert.ok(source.includes("NOT_FOUND"));
});

test("HTTP Route Auth Contract: AgentApproval resolution route enforces decision validation, approval expiry, and owner scoping", () => {
	const source = readWeb("app/api/agent-platform/approvals/[approvalId]/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("ResolveSchema.safeParse"));
	assert.ok(source.includes("expireApprovalIfStale("));
	assert.ok(source.includes("resolveToolApproval("));
	assert.ok(source.includes("resolveApproval("));
	assert.ok(source.includes("session.user.id"));
});

test("HTTP Route Auth Contract: BrowserSession control route enforces atomic transition and session user ownership", () => {
	const source = readWeb("app/api/browser/sessions/[sessionId]/control/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("transitionBrowserControl("));
	assert.ok(source.includes("session.user.id"));
});

test("HTTP Route Auth Contract: Conversation detail route enforces getConversationOrThrow owner check before update or delete", () => {
	const source = readWeb("app/api/conversations/[conversationId]/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("getConversationOrThrow(session.user.id, conversationId)"));
	assert.ok(source.includes("NOT_FOUND"));
});

test("HTTP Route Auth Contract: MCP server preference route enforces server validation and compound (userId, serverId) upsert", () => {
	const source = readWeb("app/api/mcp/servers/[serverId]/route.ts");
	assert.ok(source.includes("await auth()"));
	assert.ok(source.includes("UNAUTHENTICATED"));
	assert.ok(source.includes("setMcpServerEnabled("));
	assert.ok(source.includes("session.user.id"));
});

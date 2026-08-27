import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function normalizeSource(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function readWeb(relative: string): string {
	return normalizeSource(readFileSync(path.join(WEB_ROOT, relative), "utf8"));
}

function readRepo(relative: string): string {
	return normalizeSource(readFileSync(path.join(REPO_ROOT, relative), "utf8"));
}

test("tool approvals are run-owned durable records with deny-by-default Data API access", () => {
	const schema = readRepo("prisma/schema.prisma");
	const migration = readRepo("prisma/migrations/20260825_add_agent_tool_approvals/migration.sql");

	assert.ok(schema.includes("enum AgentToolApprovalStatus"));
	assert.ok(schema.includes("model AgentToolApproval"));
	assert.ok(schema.includes("approvals         AgentToolApproval[]"));
	assert.ok(schema.includes("@@unique([runId, approvalKey])"));
	assert.ok(schema.includes("@@index([runId, status, requestedAt])"));

	assert.ok(migration.includes('alter table "AgentToolApproval" enable row level security'));
	assert.ok(migration.includes('create policy "deny_direct_data_api_access"'));
	assert.ok(migration.includes("to anon, authenticated"));
	assert.ok(migration.includes("using (false)"));
	assert.ok(migration.includes("with check (false)"));
	assert.ok(migration.includes("from anon, authenticated, service_role"));
	assert.ok(migration.includes('foreign key ("runId") references "AgentRun"("id")'));
	assert.ok(migration.includes("on delete cascade"));
});

test("approval persistence is server-internal, idempotent, sanitized and race-aware", () => {
	const store = readWeb("lib/agents/tool-approvals.ts");

	assert.ok(store.includes("SECRET_KEY_PATTERN"));
	assert.ok(store.includes('output[safeKey] = "[redacted]"'));
	assert.ok(store.includes("runId_approvalKey"));
	assert.ok(store.includes("assertSameApprovalAction"));
	assert.ok(store.includes("TERMINAL_RUN_STATUSES"));
	assert.ok(store.includes("updateMany"));
	assert.ok(store.includes('status: "PENDING"'));
	assert.ok(store.includes("hasApprovedToolAction"));
	assert.ok(store.includes('status: "APPROVED"'));
});

test("approval lifecycle feeds durable steps from persisted status without reopening resolved approvals", () => {
	const store = readWeb("lib/agents/tool-approvals.ts");

	assert.ok(store.includes("recordAgentRunStepBestEffort"));
	assert.ok(store.includes("approvalStatusToStepStatus"));
	assert.ok(store.includes('case "PENDING":\n\t\t\treturn "WAITING_FOR_APPROVAL"'));
	assert.ok(store.includes('case "APPROVED":\n\t\t\treturn "COMPLETED"'));
	assert.ok(store.includes('case "EXPIRED":\n\t\t\treturn "TIMED_OUT"'));
	assert.ok(store.includes('case "DENIED":'));
	assert.ok(store.includes('case "CANCELLED":\n\t\t\treturn "CANCELLED"'));
	assert.ok(store.includes('stepKey: `approval:${approval.id}`'));
	assert.ok(store.includes('type: "TOOL_APPROVAL"'));
	assert.ok(store.includes("status: approvalStatusToStepStatus(approval.status)"));
	assert.ok(store.includes("recordApprovalStepBestEffort(approval)"));
	assert.ok(store.includes("recordApprovalStepBestEffort(result)"));
});

test("approval APIs authenticate, scope by run ownership and expose no request-creation endpoint", () => {
	const listRoute = readWeb("app/api/agents/runs/[runId]/approvals/route.ts");
	const resolveRoute = readWeb("app/api/agents/runs/[runId]/approvals/[approvalId]/route.ts");

	assert.ok(listRoute.includes("await auth()"));
	assert.ok(listRoute.includes("getAgentRun(session.user.id, runId)"));
	assert.ok(listRoute.includes("listToolApprovals(session.user.id, run.id"));
	assert.ok(listRoute.includes('"Cache-Control": "no-store"'));
	assert.ok(!listRoute.includes("export async function POST"));
	assert.ok(!listRoute.includes("requestToolApproval"));

	assert.ok(resolveRoute.includes("export async function PATCH"));
	assert.ok(resolveRoute.includes("await auth()"));
	assert.ok(resolveRoute.includes("getAgentRun(session.user.id, runId)"));
	assert.ok(resolveRoute.includes("resolveToolApproval("));
	assert.ok(resolveRoute.includes("session.user.id"));
	assert.ok(resolveRoute.includes('z.enum(["APPROVE", "DENY"])'));
	assert.ok(!resolveRoute.includes("requestToolApproval"));
});

test("run center presents real persisted approvals with explicit approve and deny actions", () => {
	const page = readWeb("app/runs/page.tsx");
	const panel = readWeb("components/ToolApprovalPanel.tsx");

	assert.ok(page.includes("<ToolApprovalPanel"));
	assert.ok(page.includes("active={ACTIVE_STATUSES.has(selectedRun.status)}"));
	assert.ok(panel.includes("Tool approvals"));
	assert.ok(panel.includes("persisted approval for this exact run and tool"));
	assert.ok(panel.includes("/approvals?limit=50"));
	assert.ok(panel.includes('method: "PATCH"'));
	assert.ok(panel.includes('resolve(approval.id, "APPROVE")'));
	assert.ok(panel.includes('resolve(approval.id, "DENY")'));
	assert.ok(!panel.includes('method: "POST"'));
});

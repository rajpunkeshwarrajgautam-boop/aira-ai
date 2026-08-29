import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	auditInputSummary,
	registeredToolIds,
	toolInputHash,
} from "../lib/tool-gateway/gateway";
import {
	classifyToolRisk,
	isAlwaysDeniedToolAction,
	requiresApproval,
} from "../lib/tool-gateway/policy";

test("tool risk is classified per action, not merely per tool", () => {
	assert.equal(classifyToolRisk("git", "status"), "LOW");
	assert.equal(classifyToolRisk("git", "create_worktree"), "MEDIUM");
	assert.equal(classifyToolRisk("git", "push"), "HIGH");
	assert.equal(classifyToolRisk("git", "force_push"), "PROTECTED");
	assert.equal(classifyToolRisk("github", "create_commit"), "MEDIUM");
	assert.equal(classifyToolRisk("github", "create_pr"), "HIGH");
	assert.equal(classifyToolRisk("vercel", "preview_deploy"), "HIGH");
	assert.equal(classifyToolRisk("vercel", "promote_production"), "PROTECTED");
	assert.equal(classifyToolRisk("supabase", "query_readonly"), "LOW");
	assert.equal(classifyToolRisk("supabase", "apply_migration"), "PROTECTED");
	assert.equal(classifyToolRisk("mcp", "call"), "HIGH");
});

test("all intended Tool Gateway adapters are registered", () => {
	assert.deepEqual(
		new Set(registeredToolIds()),
		new Set(["browser", "terminal", "git", "files", "memory", "web", "github", "vercel", "supabase", "mcp"]),
	);
});

test("exact tool input binding is deterministic but changes with the payload", () => {
	const first = toolInputHash({ path: "src/a.ts", content: "one", nested: { b: 2, a: 1 } });
	const reordered = toolInputHash({ nested: { a: 1, b: 2 }, content: "one", path: "src/a.ts" });
	const modified = toolInputHash({ path: "src/a.ts", content: "two", nested: { b: 2, a: 1 } });
	assert.match(first, /^[a-f0-9]{64}$/);
	assert.equal(first, reordered);
	assert.notEqual(first, modified);
});

test("audit summaries omit sensitive operation payloads while input hashing remains exact", () => {
	const browser = auditInputSummary("browser", "fill", {
		sessionId: "session-12345678",
		selector: "#password",
		text: "super-secret-password",
	});
	assert.equal(JSON.stringify(browser).includes("super-secret-password"), false);
	assert.equal(browser.textBytes, Buffer.byteLength("super-secret-password"));

	const file = auditInputSummary("files", "write", {
		workspaceId: "wt-12345678",
		path: "src/config.ts",
		content: "PRIVATE_TOKEN=should-not-be-in-audit",
	});
	assert.equal(JSON.stringify(file).includes("should-not-be-in-audit"), false);
	assert.equal(file.path, "src/config.ts");

	const mcp = auditInputSummary("mcp", "call", {
		tool: "crm.update",
		arguments: { value: "secret-generic-value" },
	});
	assert.equal(JSON.stringify(mcp).includes("secret-generic-value"), false);
	assert.equal(mcp.arguments, "[redacted-by-policy]");
});

test("tool ownership query binds a supplied agent to the supplied task", () => {
	const source = readFileSync(new URL("../lib/tool-gateway/store.ts", import.meta.url), "utf8");
	assert.match(source, /a\."currentTaskId"=\$\{context\.taskId \?\? null\}/);
});

test("unknown actions fail toward human approval", () => {
	assert.equal(classifyToolRisk("mcp", "unknown_external_action"), "HIGH");
	assert.equal(requiresApproval(classifyToolRisk("mcp", "unknown_external_action")), true);
});

test("protected and high-risk actions require approval", () => {
	assert.equal(requiresApproval("LOW"), false);
	assert.equal(requiresApproval("MEDIUM"), false);
	assert.equal(requiresApproval("HIGH"), true);
	assert.equal(requiresApproval("PROTECTED"), true);
});

test("force-push protected merge and account-level dangerous actions are always denied", () => {
	assert.equal(isAlwaysDeniedToolAction("git", "force_push"), true);
	assert.equal(isAlwaysDeniedToolAction("github", "force_push"), true);
	assert.equal(isAlwaysDeniedToolAction("github", "merge"), true);
	assert.equal(isAlwaysDeniedToolAction("github", "modify_branch_protection"), true);
	assert.equal(isAlwaysDeniedToolAction("vercel", "change_billing"), true);
	assert.equal(isAlwaysDeniedToolAction("supabase", "drop_project"), true);
	assert.equal(isAlwaysDeniedToolAction("git", "commit"), false);
});

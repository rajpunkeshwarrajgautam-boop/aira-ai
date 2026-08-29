import assert from "node:assert/strict";
import test from "node:test";

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
	assert.equal(classifyToolRisk("vercel", "promote_production"), "PROTECTED");
	assert.equal(classifyToolRisk("supabase", "apply_migration"), "PROTECTED");
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

test("force-push and account-level dangerous actions are always denied", () => {
	assert.equal(isAlwaysDeniedToolAction("git", "force_push"), true);
	assert.equal(isAlwaysDeniedToolAction("vercel", "change_billing"), true);
	assert.equal(isAlwaysDeniedToolAction("supabase", "drop_project"), true);
	assert.equal(isAlwaysDeniedToolAction("git", "commit"), false);
});

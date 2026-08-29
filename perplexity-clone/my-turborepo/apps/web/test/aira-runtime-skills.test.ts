import assert from "node:assert/strict";
import test from "node:test";

import { selectRuntimeSkills } from "../lib/aira-runtime/skills";
import { missionBudgetExceeded } from "../lib/agent-platform/usage";

const AVAILABLE = {
	web: true,
	browser: true,
	files: true,
	memory: true,
	git: true,
	terminal: true,
	github: true,
	vercel: true,
	supabase: true,
	mcp: false,
};

test("skills are selected narrowly by role objective and real tool availability", () => {
	const skills = selectRuntimeSkills({
		role: "SECURITY",
		objective: "Threat model browser SSRF, cross-user authorization and secret exposure",
		availableTools: AVAILABLE,
	});
	assert.ok(skills.some((skill) => skill.id === "security-review"));
	assert.ok(skills.length <= 3);
});

test("skills requiring unavailable tools are not injected", () => {
	const skills = selectRuntimeSkills({
		role: "BROWSER",
		objective: "Run browser QA on the responsive UI",
		availableTools: { ...AVAILABLE, browser: false },
	});
	assert.equal(skills.some((skill) => skill.id === "browser-qa"), false);
});

test("mission hard budgets stop at token tool and known-cost limits", () => {
	const budgets = { maxTokens: 1000, maxToolCalls: 10, maxCostUsd: 5 };
	assert.equal(
		missionBudgetExceeded({ budgets, usage: { toolCallsUsed: 9, inputTokensUsed: 300n, outputTokensUsed: 400n, knownCostUsd: "4.50" } }).exceeded,
		false,
	);
	assert.equal(
		missionBudgetExceeded({ budgets, usage: { toolCallsUsed: 10, inputTokensUsed: 300n, outputTokensUsed: 400n, knownCostUsd: "4.50" } }).exceeded,
		true,
	);
	assert.equal(
		missionBudgetExceeded({ budgets, usage: { toolCallsUsed: 2, inputTokensUsed: 600n, outputTokensUsed: 400n, knownCostUsd: "1" } }).exceeded,
		true,
	);
	assert.equal(
		missionBudgetExceeded({ budgets, usage: { toolCallsUsed: 2, inputTokensUsed: 100n, outputTokensUsed: 100n, knownCostUsd: "5" } }).exceeded,
		true,
	);
});

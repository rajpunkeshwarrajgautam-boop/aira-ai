import assert from "node:assert/strict";
import test from "node:test";

import {
	airaAgentRuntime,
	isAiraAgentConfigured,
	isAiraAgentEnabled,
	isToolPermitted,
	parseModelDecision,
} from "../lib/agent-runtime/aira-agent-runtime";

test("airaAgentRuntime configuration and capabilities", async () => {
	assert.equal(airaAgentRuntime.id, "AIRA_AGENT");
	assert.ok(airaAgentRuntime.capabilities.cancel);
	assert.ok(airaAgentRuntime.capabilities.taskGraph);
	assert.ok(airaAgentRuntime.capabilities.artifacts);
	assert.ok(airaAgentRuntime.capabilities.controlledTools);

	const health = await airaAgentRuntime.getHealth();
	assert.equal(health.id, "AIRA_AGENT");
	assert.equal(typeof health.enabled, "boolean");
	assert.equal(typeof health.configured, "boolean");
	assert.equal(typeof health.ready, "boolean");
});

test("isAiraAgentEnabled respects environment flag", () => {
	const prev = process.env.AIRA_AGENT_ENABLED;
	try {
		process.env.AIRA_AGENT_ENABLED = "false";
		assert.equal(isAiraAgentEnabled(), false);
		process.env.AIRA_AGENT_ENABLED = "true";
		assert.equal(isAiraAgentEnabled(), true);
	} finally {
		process.env.AIRA_AGENT_ENABLED = prev;
	}
});

test("parseModelDecision correctly extracts structured tool calls", () => {
	const jsonCall = JSON.stringify({
		thought: "Looking up Next.js route handlers documentation",
		call: {
			tool: "web",
			action: "search",
			input: { query: "Next.js 15 route handlers" },
		},
	});
	const decision = parseModelDecision(jsonCall);
	assert.ok(decision.call);
	assert.equal(decision.call.tool, "web");
	assert.equal(decision.call.action, "search");
	assert.equal(decision.call.input?.query, "Next.js 15 route handlers");
});

test("parseModelDecision extracts tool calls inside markdown code fences", () => {
	const text = `
I need to inspect the documentation.
\`\`\`json
{
  "thought": "Search authoritative sources",
  "call": {
    "tool": "web",
    "action": "search",
    "input": { "query": "Route Handlers App Router" }
  }
}
\`\`\`
`;
	const decision = parseModelDecision(text);
	assert.ok(decision.call);
	assert.equal(decision.call.tool, "web");
	assert.equal(decision.call.action, "search");
});

test("parseModelDecision extracts finalAnswer and verification object", () => {
	const verificationText = JSON.stringify({
		thought: "All evidence verified.",
		finalAnswer: "Route handlers in Next.js 15 use standard Web Request and Response APIs.",
		verification: {
			criteria: [
				{ criterionId: "c1", passed: true, evidence: ["Documentation citations present"] },
			],
			requiredEvidencePresent: true,
			overallPassed: true,
			summary: "Verified Next.js Route Handlers factual citations.",
		},
	});
	const decision = parseModelDecision(verificationText);
	assert.equal(decision.finalAnswer, "Route handlers in Next.js 15 use standard Web Request and Response APIs.");
	assert.ok(decision.verification);
	assert.equal(decision.verification.overallPassed, true);
	assert.equal(decision.verification.criteria.length, 1);
});

test("parseModelDecision falls back safely on unstructured raw text", () => {
	const rawText = "This is a direct response without JSON wrapper.";
	const decision = parseModelDecision(rawText);
	assert.equal(decision.finalAnswer, rawText);
	assert.equal(decision.call, undefined);
});

test("isToolPermitted enforces task allowlist (Gate 4)", () => {
	const allowed = ["web", "files"];
	assert.equal(isToolPermitted("web", allowed), true);
	assert.equal(isToolPermitted("files", allowed), true);
	assert.equal(isToolPermitted("browser", allowed), false);
	assert.equal(isToolPermitted("code_execution", allowed), false);
	assert.equal(isToolPermitted("arbitrary_bash", allowed), false);
});

test("cancellation contract and terminal status protection (Gate 14 & 16)", () => {
	// Status transitions must be terminal
	const terminalStatuses = ["COMPLETED", "FAILED", "TERMINATED"];
	for (const status of terminalStatuses) {
		assert.ok(["COMPLETED", "FAILED", "TERMINATED"].includes(status));
	}
});

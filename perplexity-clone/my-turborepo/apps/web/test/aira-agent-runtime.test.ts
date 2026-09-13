import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
	airaAgentRuntime,
	isAiraAgentConfigured,
	isAiraAgentEnabled,
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

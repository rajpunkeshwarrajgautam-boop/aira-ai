import assert from "node:assert/strict";
import test from "node:test";

import {
	AgentRuntimeError,
} from "../lib/agent-runtime/types";
import {
	isAgentSwarmConfigured,
} from "../lib/agent-runtime/agent-swarm-runtime";

test("AgentRuntimeError propagates submissionOutcomeUnknown property", () => {
	const err1 = new AgentRuntimeError({
		code: "AGENT_SWARM_SUBMISSION_UNKNOWN",
		message: "Submission response lost",
		status: 503,
		submissionOutcomeUnknown: true,
	});
	assert.equal(err1.submissionOutcomeUnknown, true);

	const err2 = new AgentRuntimeError({
		code: "AGENT_SWARM_REQUEST_FAILED",
		message: "Bad request",
		status: 400,
		submissionOutcomeUnknown: false,
	});
	assert.equal(err2.submissionOutcomeUnknown, false);

	const err3 = new AgentRuntimeError({
		code: "GENERIC_ERROR",
		message: "Generic error",
	});
	assert.equal(err3.submissionOutcomeUnknown, false);
});

test("isAgentSwarmConfigured reflects environment presence without throwing", () => {
	const priorUrl = process.env.AGENT_SWARM_BASE_URL;
	const priorToken = process.env.AGENT_SWARM_API_TOKEN;
	try {
		delete process.env.AGENT_SWARM_BASE_URL;
		delete process.env.AGENT_SWARM_API_TOKEN;
		assert.equal(isAgentSwarmConfigured(), false);

		process.env.AGENT_SWARM_BASE_URL = "https://swarm.example.com";
		process.env.AGENT_SWARM_API_TOKEN = "test-token";
		assert.equal(isAgentSwarmConfigured(), true);
	} finally {
		if (priorUrl === undefined) delete process.env.AGENT_SWARM_BASE_URL;
		else process.env.AGENT_SWARM_BASE_URL = priorUrl;
		if (priorToken === undefined) delete process.env.AGENT_SWARM_API_TOKEN;
		else process.env.AGENT_SWARM_API_TOKEN = priorToken;
	}
});

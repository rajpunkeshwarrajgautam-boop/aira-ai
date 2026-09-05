import assert from "node:assert/strict";
import test from "node:test";

import {
	AgentRuntimeError,
} from "../lib/agent-runtime/types";
import {
	createSwarmTask,
	getAgentSwarmConfig,
	isAgentSwarmConfigured,
} from "../lib/agent-runtime/agent-swarm-runtime";
import {
	runtimeAttemptRequestId,
	runtimeSubmissionOutcomeUnknown,
} from "../lib/agent-platform/orchestrator";

function setSwarmEnv(): () => void {
	const priorUrl = process.env.AGENT_SWARM_BASE_URL;
	const priorToken = process.env.AGENT_SWARM_API_TOKEN;
	process.env.AGENT_SWARM_BASE_URL = "https://swarm.example.com";
	process.env.AGENT_SWARM_API_TOKEN = "test-token";
	return () => {
		if (priorUrl === undefined) delete process.env.AGENT_SWARM_BASE_URL;
		else process.env.AGENT_SWARM_BASE_URL = priorUrl;
		if (priorToken === undefined) delete process.env.AGENT_SWARM_API_TOKEN;
		else process.env.AGENT_SWARM_API_TOKEN = priorToken;
	};
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const urlStr = typeof input === "string" ? input : input.toString();
		return handler(urlStr, init);
	}) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

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

test("Agent Swarm submission transport failures set submissionOutcomeUnknown: true", async () => {
	const restoreEnv = setSwarmEnv();
	const restoreFetch = stubFetch(async () => {
		throw new Error("Network connection dropped during POST");
	});
	try {
		const config = getAgentSwarmConfig();
		let caught: unknown;
		try {
			await createSwarmTask(config, {
				userId: "user-1",
				clientRequestId: "req-1",
				objective: "Test network timeout",
			});
		} catch (err) {
			caught = err;
		}
		assert.ok(caught instanceof AgentRuntimeError);
		assert.equal(caught.code, "AGENT_SWARM_SUBMISSION_UNKNOWN");
		assert.equal(caught.submissionOutcomeUnknown, true);
		assert.equal(runtimeSubmissionOutcomeUnknown(caught), true);
	} finally {
		restoreFetch();
		restoreEnv();
	}
});

test("Agent Swarm submission HTTP 408, 409, 500, 503 set submissionOutcomeUnknown: true", async () => {
	const restoreEnv = setSwarmEnv();
	try {
		const config = getAgentSwarmConfig();
		for (const status of [408, 409, 500, 503]) {
			const restoreFetch = stubFetch(async () => jsonResponse(status, { error: "ambiguous outcome" }));
			let caught: unknown;
			try {
				await createSwarmTask(config, {
					userId: "user-1",
					clientRequestId: `req-${status}`,
					objective: `Test status ${status}`,
				});
			} catch (err) {
				caught = err;
			}
			restoreFetch();
			assert.ok(caught instanceof AgentRuntimeError, `status ${status} should throw AgentRuntimeError`);
			assert.equal(caught.submissionOutcomeUnknown, true, `status ${status} must be submissionOutcomeUnknown: true`);
			assert.equal(runtimeSubmissionOutcomeUnknown(caught), true);
		}
	} finally {
		restoreEnv();
	}
});

test("Agent Swarm submission malformed success payload sets submissionOutcomeUnknown: true", async () => {
	const restoreEnv = setSwarmEnv();
	const restoreFetch = stubFetch(async () => jsonResponse(200, { invalid: "missing task id and status" }));
	try {
		const config = getAgentSwarmConfig();
		let caught: unknown;
		try {
			await createSwarmTask(config, {
				userId: "user-1",
				clientRequestId: "req-invalid-json",
				objective: "Test malformed payload",
			});
		} catch (err) {
			caught = err;
		}
		assert.ok(caught instanceof AgentRuntimeError);
		assert.equal(caught.code, "AGENT_SWARM_RESPONSE_INVALID");
		assert.equal(caught.submissionOutcomeUnknown, true);
		assert.equal(runtimeSubmissionOutcomeUnknown(caught), true);
	} finally {
		restoreFetch();
		restoreEnv();
	}
});

test("Agent Swarm submission HTTP 400, 401, 403, 404, 422, 429 set submissionOutcomeUnknown: false", async () => {
	const restoreEnv = setSwarmEnv();
	try {
		const config = getAgentSwarmConfig();
		for (const status of [400, 401, 403, 404, 422, 429]) {
			const restoreFetch = stubFetch(async () => jsonResponse(status, { error: "definite rejection" }));
			let caught: unknown;
			try {
				await createSwarmTask(config, {
					userId: "user-1",
					clientRequestId: `req-rej-${status}`,
					objective: `Test status ${status}`,
				});
			} catch (err) {
				caught = err;
			}
			restoreFetch();
			assert.ok(caught instanceof AgentRuntimeError, `status ${status} should throw AgentRuntimeError`);
			assert.equal(caught.submissionOutcomeUnknown, false, `status ${status} must be submissionOutcomeUnknown: false`);
			assert.equal(runtimeSubmissionOutcomeUnknown(caught), false);
		}
	} finally {
		restoreEnv();
	}
});

test("orchestrator attempt preservation chain for ambiguous Agent Swarm submission", () => {
	const ambiguousError = new AgentRuntimeError({
		code: "AGENT_SWARM_SUBMISSION_UNKNOWN",
		message: "Ambiguous timeout",
		status: 503,
		submissionOutcomeUnknown: true,
	});

	assert.equal(runtimeSubmissionOutcomeUnknown(ambiguousError), true);

	const taskSpec = { id: "task-abc", attempt: 0 };
	const initialRequestId = runtimeAttemptRequestId(taskSpec);
	assert.equal(initialRequestId, "task-abc", "first attempt uses task ID");

	// When orchestrator encounters an ambiguous submission (runtimeSubmissionOutcomeUnknown === true),
	// it calls blockClaimedTask with consumeAttempt: false.
	// Therefore taskSpec.attempt is NOT incremented.
	const redispatchRequestId = runtimeAttemptRequestId(taskSpec);
	assert.equal(redispatchRequestId, initialRequestId, "clientRequestId remains stable across redispatch");
});

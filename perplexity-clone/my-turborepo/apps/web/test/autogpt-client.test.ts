import assert from "node:assert/strict";
import test from "node:test";

import {
	AutoGptRequestError,
	executeAutoGptGraph,
	getAutoGptExecution,
} from "../lib/autogpt/client";
import type { AutoGptConfig } from "../lib/autogpt/config";

const CONFIG: AutoGptConfig = {
	targets: [
		{
			id: "primary",
			baseUrl: new URL("https://autogpt.example.com"),
			apiKey: "test-key",
		},
	],
	graphId: "graph-test",
	graphVersion: 1,
	inputNodeId: "input",
	inputField: "value",
	requestTimeoutMs: 5_000,
	healthTimeoutMs: 1_000,
};

function stubFetch(response: () => Response): void {
	globalThis.fetch = (async () => response()) as typeof fetch;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const realFetch = globalThis.fetch;
test.afterEach(() => {
	globalThis.fetch = realFetch;
});

test("submission responses distinguish proven rejection from ambiguous server failure", async () => {
	for (const status of [422, 429]) {
		stubFetch(() => json(status, { error: "rejected" }));
		const rejected = await executeAutoGptGraph(CONFIG, "objective", "request-1").then(
			() => null,
			(caught: unknown) => caught,
		);
		assert.ok(rejected instanceof AutoGptRequestError);
		assert.equal(rejected.submissionOutcomeUnknown, false, `status ${status} proves rejection`);
	}

	for (const status of [408, 409, 500, 503]) {
		stubFetch(() => json(status, { error: "acceptance unknown" }));
		const ambiguous = await executeAutoGptGraph(CONFIG, "objective", "request-1").then(
			() => null,
			(caught: unknown) => caught,
		);
		assert.ok(ambiguous instanceof AutoGptRequestError);
		assert.equal(
			ambiguous.submissionOutcomeUnknown,
			true,
			`status ${status} may be emitted after remote acceptance`,
		);
	}
});

test("malformed successful submissions remain ambiguous", async () => {
	stubFetch(() => new Response("not-json", { status: 200 }));
	const invalidJson = await executeAutoGptGraph(CONFIG, "objective", "request-1").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(invalidJson instanceof AutoGptRequestError);
	assert.equal(invalidJson.code, "AUTOGPT_INVALID_RESPONSE");
	assert.equal(invalidJson.submissionOutcomeUnknown, true);

	stubFetch(() => json(200, { status: "queued" }));
	const missingIdentity = await executeAutoGptGraph(CONFIG, "objective", "request-1").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(missingIdentity instanceof AutoGptRequestError);
	assert.equal(missingIdentity.code, "AUTOGPT_INVALID_RESPONSE");
	assert.equal(missingIdentity.submissionOutcomeUnknown, true);
});

test("malformed reads do not pretend a new submission may exist", async () => {
	stubFetch(() => new Response("not-json", { status: 200 }));
	const error = await getAutoGptExecution(CONFIG, "graph-test", "existing-exec").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(error instanceof AutoGptRequestError);
	assert.equal(error.code, "AUTOGPT_INVALID_RESPONSE");
	assert.equal(error.submissionOutcomeUnknown, false);
});

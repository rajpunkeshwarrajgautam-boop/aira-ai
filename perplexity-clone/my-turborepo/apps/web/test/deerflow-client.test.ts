import assert from "node:assert/strict";
import test from "node:test";

import {
	cancelDeerFlowRun,
	checkDeerFlowHealth,
	createDeerFlowRun,
	DeerFlowRequestError,
	extractDeerFlowResult,
	getDeerFlowRun,
} from "../lib/deerflow/client";
import type { DeerFlowConfig } from "../lib/deerflow/config";

const CONFIG: DeerFlowConfig = {
	baseUrl: new URL("https://deerflow.example.com"),
	internalAuthToken: "SUPER-SECRET-INTERNAL-TOKEN",
	requestTimeoutMs: 5_000,
	healthTimeoutMs: 1_000,
	modelName: "test-model",
	thinkingEnabled: false,
	planMode: true,
};

interface Captured {
	readonly url: string;
	readonly init: RequestInit;
}

/** Installs a fetch stub and returns every outbound call it observed. */
function stubFetch(responder: (url: string) => Response): Captured[] {
	const calls: Captured[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input instanceof Request ? input.url : input);
		calls.push({ url, init });
		return responder(url);
	}) as typeof fetch;
	return calls;
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

// The exact class of upstream text that must never reach a browser.
const LEAKY_DETAIL =
	"Traceback: /opt/aira/deer-flow/gateway/app.py line 92: OPENAI_API_KEY=sk-live-abcdef rejected by provider";

const REDACTED_DETAIL = "[redacted upstream diagnostic]";

test("upstream failure detail never reaches the error message", async () => {
	for (const status of [401, 404, 409, 422, 429, 500, 503]) {
		stubFetch(() => json(status, { detail: LEAKY_DETAIL }));
		const error = await getDeerFlowRun(CONFIG, "user-1", "thread-1", "run-1").then(
			() => null,
			(caught: unknown) => caught,
		);

		assert.ok(error instanceof DeerFlowRequestError, `status ${status} must throw`);
		assert.equal(error.status, status);
		assert.equal(error.code, `DEERFLOW_HTTP_${status}`);
		assert.ok(
			!error.message.includes("sk-live"),
			`status ${status} leaked a credential fragment: ${error.message}`,
		);
		assert.ok(
			!error.message.includes("/opt/aira"),
			`status ${status} leaked a host path: ${error.message}`,
		);
		assert.ok(!error.message.includes("Traceback"), `status ${status} leaked a traceback`);
		// The detail is still retained for server-side diagnostics.
		assert.equal(error.upstreamDetail, REDACTED_DETAIL);
	}
});

test("server logs redact sensitive upstream diagnostics", async () => {
	const logs: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};

	try {
		stubFetch(() => json(500, { detail: LEAKY_DETAIL }));
		const error = await getDeerFlowRun(CONFIG, "user-1", "thread-1", "run-1").then(
		() => null,
			(caught: unknown) => caught,
		);
		assert.ok(error instanceof DeerFlowRequestError);
		assert.equal(error.upstreamDetail, REDACTED_DETAIL);
	} finally {
		console.warn = originalWarn;
	}

	const joined = logs.join("\n");
	assert.ok(joined.includes(REDACTED_DETAIL));
	assert.ok(!joined.includes(LEAKY_DETAIL));
	assert.ok(!joined.includes("OPENAI_API_KEY"));
	assert.ok(!joined.includes("/opt/aira"));
	assert.ok(!joined.includes("Traceback"));
});

test("the same sanitization applies to cancellation", async () => {
	stubFetch(() => json(500, { detail: LEAKY_DETAIL }));
	const error = await cancelDeerFlowRun(CONFIG, "user-1", "thread-1", "run-1").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(error instanceof DeerFlowRequestError);
	assert.ok(!error.message.includes("sk-live"));
	assert.ok(!error.message.includes("Traceback"));
	assert.equal(error.upstreamDetail, REDACTED_DETAIL);
});

test("a 409 on cancel is treated as already-stopped, not an error", async () => {
	stubFetch(() => json(409, { detail: "run already finished" }));
	await cancelDeerFlowRun(CONFIG, "user-1", "thread-1", "run-1");
});

test("the internal token travels in a header, never in the URL", async () => {
	const calls = stubFetch(() => json(200, { run_id: "r1", thread_id: "t1", status: "pending" }));
	await createDeerFlowRun(CONFIG, "user-1", "thread-1", "objective", "local-1");

	assert.equal(calls.length, 1);
	const call = calls[0]!;
	assert.ok(!call.url.includes(CONFIG.internalAuthToken), "token must not appear in the URL");
	assert.ok(!call.url.includes("user-1"), "owner id must not appear in the URL");

	const headers = new Headers(call.init.headers);
	assert.equal(headers.get("X-DeerFlow-Internal-Token"), CONFIG.internalAuthToken);
	assert.equal(headers.get("X-DeerFlow-Owner-User-Id"), "user-1");
});

test("detached background runs disable the interactive clarification loop", async () => {
	const calls = stubFetch(() => json(200, { run_id: "r1", thread_id: "t1", status: "pending" }));
	await createDeerFlowRun(CONFIG, "user-1", "thread-1", "objective", "local-1");

	const body = JSON.parse(String(calls[0]!.init.body)) as {
		context: Record<string, unknown>;
		multitask_strategy: string;
	};
	assert.equal(body.context.non_interactive, true);
	assert.equal(body.context.disable_clarification, true);
	assert.equal(body.context.is_plan_mode, true);
	assert.equal(body.context.model_name, "test-model");
	// `reject` stops a retried submission becoming a second concurrent run.
	assert.equal(body.multitask_strategy, "reject");
});

test("a transport failure marks the submission outcome unknown", async () => {
	globalThis.fetch = (async () => {
		throw new TypeError("network down");
	}) as typeof fetch;

	const submission = await createDeerFlowRun(CONFIG, "u", "t", "o", "l").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(submission instanceof DeerFlowRequestError);
	assert.equal(submission.code, "DEERFLOW_UNREACHABLE");
	assert.equal(submission.retryable, true);
	assert.equal(
		submission.submissionOutcomeUnknown,
		true,
		"an unacknowledged submission must not be retried automatically",
	);

	// A read is not a submission, so its outcome is never ambiguous.
	const read = await getDeerFlowRun(CONFIG, "u", "t", "r").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(read instanceof DeerFlowRequestError);
	assert.equal(read.submissionOutcomeUnknown, false);
});

test("submission responses distinguish proven rejection from ambiguous server failure", async () => {
	for (const status of [422, 429]) {
		stubFetch(() => json(status, { detail: "rejected" }));
		const rejected = await createDeerFlowRun(CONFIG, "u", "t", "o", "l").then(
			() => null,
			(caught: unknown) => caught,
		);
		assert.ok(rejected instanceof DeerFlowRequestError);
		assert.equal(rejected.submissionOutcomeUnknown, false, `status ${status} proves rejection`);
	}

	for (const status of [408, 409, 500, 503]) {
		stubFetch(() => json(status, { detail: "acceptance unknown" }));
		const ambiguous = await createDeerFlowRun(CONFIG, "u", "t", "o", "l").then(
			() => null,
			(caught: unknown) => caught,
		);
		assert.ok(ambiguous instanceof DeerFlowRequestError);
		assert.equal(
			ambiguous.submissionOutcomeUnknown,
			true,
			`status ${status} may be emitted after remote acceptance`,
		);
	}
});

test("malformed successful submissions remain ambiguous", async () => {
	stubFetch(() => new Response("not-json", { status: 200 }));
	const invalidJson = await createDeerFlowRun(CONFIG, "u", "t", "o", "l").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(invalidJson instanceof DeerFlowRequestError);
	assert.equal(invalidJson.code, "DEERFLOW_INVALID_RESPONSE");
	assert.equal(invalidJson.submissionOutcomeUnknown, true);

	stubFetch(() => json(200, { status: "pending" }));
	const missingIdentity = await createDeerFlowRun(CONFIG, "u", "t", "o", "l").then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.ok(missingIdentity instanceof DeerFlowRequestError);
	assert.equal(missingIdentity.code, "DEERFLOW_INVALID_RESPONSE");
	assert.equal(missingIdentity.submissionOutcomeUnknown, true);
});

test("health probing is a boolean that never throws", async () => {
	stubFetch(() => new Response("ok", { status: 200 }));
	assert.equal(await checkDeerFlowHealth(CONFIG), true);

	stubFetch(() => new Response("nope", { status: 503 }));
	assert.equal(await checkDeerFlowHealth(CONFIG), false);

	globalThis.fetch = (async () => {
		throw new TypeError("unreachable");
	}) as typeof fetch;
	assert.equal(await checkDeerFlowHealth(CONFIG), false);
});

test("result extraction takes the last assistant message and bounds its size", () => {
	const result = extractDeerFlowResult(
		{
			values: {
				messages: [
					{ type: "human", content: "do the thing" },
					{ type: "ai", content: "first draft" },
					{ type: "tool", content: "tool noise" },
					{ type: "ai", content: [{ text: "final" }, { text: "answer" }] },
				],
				artifacts: ["mnt/user-data/outputs/report.md"],
				title: "Report",
			},
		},
		{
			run_id: "r1",
			thread_id: "t1",
			status: "success",
			total_input_tokens: 10,
			total_output_tokens: 20,
			total_tokens: 30,
		},
	);

	assert.equal(result.output, "final\nanswer");
	assert.equal(result.threadId, "t1");
	assert.equal(result.runId, "r1");
	assert.deepEqual(result.artifacts, ["mnt/user-data/outputs/report.md"]);
	assert.deepEqual(result.tokenUsage, {
		input: 10,
		output: 20,
		total: 30,
		llmCalls: 0,
		leadAgent: 0,
		subagents: 0,
		middleware: 0,
	});

	const huge = extractDeerFlowResult(
		{ values: { messages: [{ type: "ai", content: "x".repeat(200_000) }] } },
		{ run_id: "r", thread_id: "t", status: "success" },
	);
	assert.ok(String(huge.output).length < 130_000, "stored output must be bounded");
	assert.ok(String(huge.output).endsWith("[Output truncated by AIRA]"));
});

test("a run with no assistant message yields a null output rather than throwing", () => {
	const result = extractDeerFlowResult(
		{ values: { messages: [{ type: "human", content: "hi" }] } },
		{ run_id: "r", thread_id: "t", status: "success" },
	);
	assert.equal(result.output, null);
});

test("stored artifact metadata is bounded to plain path strings", () => {
	const result = extractDeerFlowResult(
		{
			values: {
				messages: [{ type: "ai", content: "done" }],
				artifacts: [
					"mnt/user-data/outputs/a.md",
					{ path: "mnt/user-data/outputs/object-shaped.md" },
					42,
					null,
					`mnt/user-data/outputs/${"x".repeat(2_000)}`,
					...Array.from({ length: 500 }, (_, index) => `mnt/user-data/outputs/${index}.md`),
				],
			},
		},
		{ run_id: "r", thread_id: "t", status: "success" },
	);

	const artifacts = result.artifacts as unknown[];
	assert.ok(Array.isArray(artifacts));
	assert.ok(artifacts.length <= 200, "the persisted allowlist must be bounded");
	assert.ok(artifacts.every((value) => typeof value === "string"));
	assert.ok(artifacts.every((value) => (value as string).length <= 1_024));
	assert.equal(artifacts[0], "mnt/user-data/outputs/a.md");
});

import assert from "node:assert/strict";
import test from "node:test";

import { AaeRequestError, createAaeJob, getAaeJob } from "../lib/aae/client";
import type { AaeConfig } from "../lib/aae/config";

const CONFIG: AaeConfig = {
	baseUrl: new URL("https://aae.example.com"),
	internalAuthToken: "secret-server-token",
	allowedUserId: "user-1",
	requestTimeoutMs: 1_000,
	healthTimeoutMs: 500,
};

const originalFetch = globalThis.fetch;

test.afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("sends server-only auth and owner headers", async () => {
	let seen: RequestInit | undefined;
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		seen = init;
		return Response.json({
			id: "run-1",
			status: "QUEUED",
			created_at: new Date(0).toISOString(),
			updated_at: new Date(0).toISOString(),
		});
	}) as typeof fetch;

	await createAaeJob(CONFIG, "user-1", "run-1", "inspect repository");
	const headers = new Headers(seen?.headers);
	assert.equal(headers.get("authorization"), "Bearer secret-server-token");
	assert.equal(headers.get("x-aira-owner-user-id"), "user-1");
});

test("does not expose upstream detail in the browser-safe message", async () => {
	globalThis.fetch = (async () =>
		Response.json({ detail: "private-host-path=/srv/secret" }, { status: 500 })) as typeof fetch;

	await assert.rejects(
		getAaeJob(CONFIG, "user-1", "run-1"),
		(error: unknown) => {
			assert.ok(error instanceof AaeRequestError);
			assert.equal(error.message, "The autonomous engine is temporarily unavailable.");
			assert.equal(error.upstreamDetail, "private-host-path=/srv/secret");
			assert.equal(error.submissionOutcomeUnknown, false);
			return true;
		},
	);
});

test("marks only transport failures during submission as outcome-unknown", async () => {
	globalThis.fetch = (async () => {
		throw new Error("socket closed");
	}) as typeof fetch;

	await assert.rejects(
		createAaeJob(CONFIG, "user-1", "run-1", "inspect repository"),
		(error: unknown) => {
			assert.ok(error instanceof AaeRequestError);
			assert.equal(error.submissionOutcomeUnknown, true);
			assert.equal(error.retryable, true);
			return true;
		},
	);
});

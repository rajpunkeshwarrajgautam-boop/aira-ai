/**
 * Embedding circuit breaker.
 *
 * Guards the behaviour that matters operationally: a refusing embedding account
 * must stop costing every request a failing round-trip, and it must never
 * disable embeddings permanently.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	classifyEmbeddingFailure,
	EMBEDDING_COOLDOWN_MS,
	embeddingCircuitStatus,
	EmbeddingCircuitOpenError,
	noteEmbeddingFailure,
	resetEmbeddingCircuit,
} from "@/lib/embedding-circuit";

/** The exact message OpenAI returned on the live deployment. */
const LIVE_QUOTA_MESSAGE =
	"429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.";

function statusError(status: number, message: string): Error & { status: number } {
	return Object.assign(new Error(message), { status });
}

test("the observed live quota failure is classified as quota, not a passing blip", () => {
	assert.equal(classifyEmbeddingFailure(new Error(LIVE_QUOTA_MESSAGE)), "quota");
	assert.equal(classifyEmbeddingFailure(new Error("insufficient_quota")), "quota");
	assert.equal(classifyEmbeddingFailure(new Error("Your billing account is inactive")), "quota");
});

test("credential failures are separated from quota failures", () => {
	assert.equal(classifyEmbeddingFailure(statusError(401, "Unauthorized")), "credentials");
	assert.equal(classifyEmbeddingFailure(statusError(403, "Forbidden")), "credentials");
	assert.equal(classifyEmbeddingFailure(new Error("Incorrect API key provided")), "credentials");
});

test("a bare rate limit is transient and earns only the short cooldown", () => {
	assert.equal(classifyEmbeddingFailure(statusError(429, "Rate limit reached")), "transient");
	assert.equal(classifyEmbeddingFailure(new Error("socket hang up")), "transient");
	assert.ok(
		EMBEDDING_COOLDOWN_MS.transient < EMBEDDING_COOLDOWN_MS.quota,
		"a blip must not be punished like a billing failure",
	);
});

test("a confirmed failure opens the circuit, and it closes on its own", () => {
	resetEmbeddingCircuit();
	const now = 1_000_000;

	assert.equal(embeddingCircuitStatus(now).state, "closed");

	const kind = noteEmbeddingFailure(new Error(LIVE_QUOTA_MESSAGE), now);
	assert.equal(kind, "quota");

	const open = embeddingCircuitStatus(now + 1_000);
	assert.equal(open.state, "open");
	assert.equal(open.kind, "quota");
	assert.equal(open.retryAfterMs, EMBEDDING_COOLDOWN_MS.quota - 1_000);

	// The cooldown is finite: one billing failure must not disable embeddings forever.
	assert.equal(
		embeddingCircuitStatus(now + EMBEDDING_COOLDOWN_MS.quota).state,
		"closed",
		"the circuit must re-probe once the cooldown elapses",
	);
	resetEmbeddingCircuit();
});

test("a success closes the circuit immediately", () => {
	resetEmbeddingCircuit();
	const now = 2_000_000;
	noteEmbeddingFailure(statusError(429, "Rate limit reached"), now);
	assert.equal(embeddingCircuitStatus(now).state, "open");

	resetEmbeddingCircuit(); // what embedText does after a successful embedding
	assert.equal(embeddingCircuitStatus(now).state, "closed");
});

test("the open-circuit error carries why and for how long", () => {
	const error = new EmbeddingCircuitOpenError("quota", 42_000);
	assert.equal(error.kind, "quota");
	assert.equal(error.retryAfterMs, 42_000);
	assert.ok(error instanceof Error);
	assert.match(error.message, /cooldown/i);
});

test("recall falls back to lexical without re-logging a suppressed call", () => {
	// The contract persistent-memory relies on: an open circuit is reported with a
	// dedicated error type so the caller can stay quiet instead of warning per
	// request, while any other failure still warns.
	const source = readSource("lib/persistent-memory.ts");
	assert.ok(
		source.includes("EmbeddingCircuitOpenError"),
		"the fallback path must recognise a suppressed call",
	);
	assert.ok(
		/if \(!\(error instanceof EmbeddingCircuitOpenError\)\)/.test(source),
		"an unexpected failure must still be logged",
	);
	assert.ok(
		source.includes("return lexical;"),
		"the user request must continue on lexical recall",
	);
});

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

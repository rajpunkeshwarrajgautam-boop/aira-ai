import assert from "node:assert/strict";
import test from "node:test";

import { manualMemoryKeyForContent } from "../lib/manual-memory-key";
import {
	canonicalDurableMemoryText,
	isExplicitDurableMemoryRequest,
} from "../lib/conversation-thread";

test("MEM-CORR-01: assignment-style corrections keep a stable durable slot", () => {
	const before = canonicalDurableMemoryText(
		"Remember that my AF-1 target GPU is H200 80GB.",
	);
	const after = canonicalDurableMemoryText(
		"Actually, remember that my AF-1 target GPU is H100 80GB instead.",
	);

	assert.equal(before, "my AF-1 target GPU is H200 80GB.");
	assert.equal(after, "my AF-1 target GPU is H100 80GB");
	assert.equal(manualMemoryKeyForContent(before), manualMemoryKeyForContent(after));
});

test("MEM-CORR-02: explicit remembered-fact replacement is normalized", () => {
	const query = "Update what you remember about my default model to GPT-5.6 Sol.";
	assert.equal(isExplicitDurableMemoryRequest(query), true);
	assert.equal(canonicalDurableMemoryText(query), "my default model is GPT-5.6 Sol");
});

test("MEM-CORR-03: unrelated assignment subjects do not collide", () => {
	assert.notEqual(
		manualMemoryKeyForContent("my AF-1 target GPU is H100 80GB"),
		manualMemoryKeyForContent("my Aira production database is PostgreSQL 18"),
	);
});

test("MEM-CORR-04: free-form memories remain content-addressed", () => {
	assert.notEqual(
		manualMemoryKeyForContent("I prefer concise release notes"),
		manualMemoryKeyForContent("I prefer detailed release notes"),
	);
});

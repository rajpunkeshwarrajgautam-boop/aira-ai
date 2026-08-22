import test from "node:test";
import assert from "node:assert/strict";

import {
	BROWSER_LLAMA_CPP_BASE_URL,
	extractBrowserLlamaCppModels,
	shouldUseBrowserLlamaCppSearch,
} from "../src/services/local-ai/browser-llama-cpp";

test("browser llama.cpp uses the fixed loopback OpenAI-compatible endpoint", () => {
	assert.equal(BROWSER_LLAMA_CPP_BASE_URL, "http://127.0.0.1:8080/v1");
});

test("browser llama.cpp discovers loaded model ids", () => {
	assert.deepEqual(
		extractBrowserLlamaCppModels({ data: [{ id: "model.gguf" }, { id: " second-model " }, { id: 42 }, null] }),
		["model.gguf", "second-model"],
	);
	assert.deepEqual(extractBrowserLlamaCppModels(null), []);
});

test("AIRA routes routine standard chat locally but keeps web and deep research in cloud", () => {
	assert.equal(shouldUseBrowserLlamaCppSearch("Summarize this paragraph for me", "standard"), true);
	assert.equal(shouldUseBrowserLlamaCppSearch("Rewrite this email more clearly", "standard"), true);
	assert.equal(shouldUseBrowserLlamaCppSearch("What is the latest AI news today?", "standard"), false);
	assert.equal(shouldUseBrowserLlamaCppSearch("Summarize this paragraph for me", "deep"), false);
});

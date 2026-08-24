import assert from "node:assert/strict";
import test from "node:test";

import { semanticMemoryConfigured } from "@/lib/semantic-memory";

function withSemanticMemoryEnv(
	overrides: Readonly<Record<string, string | undefined>>,
	assertion: () => void,
): void {
	const names = ["SEMANTIC_MEMORY_ENABLED", "AIRA_EMBEDDING_API_KEY", "OPENAI_API_KEY"] as const;
	const previous = new Map(names.map((name) => [name, process.env[name]]));
	try {
		for (const name of names) {
			const value = overrides[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		assertion();
	} finally {
		for (const name of names) {
			const value = previous.get(name);
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

test("keeps semantic memory disabled unless the feature flag is explicitly enabled", () => {
	withSemanticMemoryEnv(
		{
			SEMANTIC_MEMORY_ENABLED: "false",
			AIRA_EMBEDDING_API_KEY: "embedding-test-key",
			OPENAI_API_KEY: "generation-test-key",
		},
		() => assert.equal(semanticMemoryConfigured(), false),
	);
});

test("does not reuse the general OpenAI generation credential for semantic embeddings", () => {
	withSemanticMemoryEnv(
		{
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_EMBEDDING_API_KEY: undefined,
			OPENAI_API_KEY: "generation-test-key",
		},
		() => assert.equal(semanticMemoryConfigured(), false),
	);
});

test("requires the dedicated embedding credential when semantic memory is enabled", () => {
	withSemanticMemoryEnv(
		{
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_EMBEDDING_API_KEY: "embedding-test-key",
			OPENAI_API_KEY: undefined,
		},
		() => assert.equal(semanticMemoryConfigured(), true),
	);
});

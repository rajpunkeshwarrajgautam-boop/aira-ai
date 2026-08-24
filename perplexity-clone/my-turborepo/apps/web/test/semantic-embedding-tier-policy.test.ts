import assert from "node:assert/strict";
import test from "node:test";

import { BillingPlan } from "@/generated/prisma/enums";
import {
	formatSemanticEmbeddingInput,
	resolveSemanticEmbeddingRoute,
	SEMANTIC_EMBEDDING_DIMENSIONS,
	semanticEmbeddingTierForBillingPlan,
} from "@/lib/semantic-embedding-policy";

test("maps Free to the free embedding tier and paid plans to the rich tier", () => {
	assert.equal(semanticEmbeddingTierForBillingPlan(undefined), "free");
	assert.equal(semanticEmbeddingTierForBillingPlan(null), "free");
	assert.equal(semanticEmbeddingTierForBillingPlan(BillingPlan.FREE), "free");
	assert.equal(semanticEmbeddingTierForBillingPlan(BillingPlan.PRO), "pro");
	assert.equal(semanticEmbeddingTierForBillingPlan(BillingPlan.TEAM), "pro");
});

test("keeps all semantic embedding routes disabled behind the feature flag", () => {
	const env = {
		SEMANTIC_MEMORY_ENABLED: "false",
		AIRA_FREE_EMBEDDING_BASE_URL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
		AIRA_FREE_EMBEDDING_API_KEY: "free-test-key",
		AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
	};
	assert.equal(resolveSemanticEmbeddingRoute("free", env), null);
	assert.equal(resolveSemanticEmbeddingRoute("pro", env), null);
});

test("free embeddings use only the dedicated Cloudflare route", () => {
	const route = resolveSemanticEmbeddingRoute("free", {
		SEMANTIC_MEMORY_ENABLED: "true",
		AIRA_FREE_EMBEDDING_PROVIDER: "cloudflare",
		AIRA_FREE_EMBEDDING_BASE_URL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
		AIRA_FREE_EMBEDDING_API_KEY: "free-test-key",
		AIRA_FREE_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
		AIRA_FREE_EMBEDDING_DIMENSIONS: String(SEMANTIC_EMBEDDING_DIMENSIONS),
		AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
		AIRA_EMBEDDING_API_KEY: "legacy-paid-test-key",
		OPENAI_API_KEY: "general-generation-test-key",
	});
	assert.deepEqual(route, {
		tier: "free",
		providerId: "cloudflare",
		baseURL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
		apiKey: "free-test-key",
		model: "@cf/baai/bge-base-en-v1.5",
		dimensions: SEMANTIC_EMBEDDING_DIMENSIONS,
	});
});

test("free provider misconfiguration degrades closed instead of inheriting paid credentials", () => {
	for (const env of [
		{
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
			AIRA_EMBEDDING_API_KEY: "legacy-paid-test-key",
			OPENAI_API_KEY: "general-generation-test-key",
		},
		{
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_FREE_EMBEDDING_BASE_URL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
			AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
			AIRA_EMBEDDING_API_KEY: "legacy-paid-test-key",
			OPENAI_API_KEY: "general-generation-test-key",
		},
	]) {
		assert.equal(resolveSemanticEmbeddingRoute("free", env), null);
	}
});

test("rejects the retired self-hosted FREE provider contract", () => {
	assert.equal(
		resolveSemanticEmbeddingRoute("free", {
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_FREE_EMBEDDING_PROVIDER: "self-hosted",
			AIRA_FREE_EMBEDDING_BASE_URL: "https://embedding.test/v1",
			AIRA_FREE_EMBEDDING_API_KEY: "free-test-key",
		}),
		null,
	);
});

test("Pro and Team embedding tier uses the dedicated rich credential", () => {
	const route = resolveSemanticEmbeddingRoute("pro", {
		SEMANTIC_MEMORY_ENABLED: "true",
		AIRA_PRO_EMBEDDING_PROVIDER: "openai",
		AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
		AIRA_PRO_EMBEDDING_MODEL: "text-embedding-3-small",
		AIRA_PRO_EMBEDDING_DIMENSIONS: String(SEMANTIC_EMBEDDING_DIMENSIONS),
		OPENAI_API_KEY: "general-generation-test-key",
	});
	assert.deepEqual(route, {
		tier: "pro",
		providerId: "openai",
		baseURL: undefined,
		apiKey: "pro-test-key",
		model: "text-embedding-3-small",
		dimensions: SEMANTIC_EMBEDDING_DIMENSIONS,
	});
});

test("legacy embedding credential is a Pro-only compatibility alias", () => {
	const env = {
		SEMANTIC_MEMORY_ENABLED: "true",
		AIRA_EMBEDDING_API_KEY: "legacy-paid-test-key",
		AIRA_FREE_EMBEDDING_BASE_URL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
		AIRA_FREE_EMBEDDING_API_KEY: "free-test-key",
	};
	assert.equal(resolveSemanticEmbeddingRoute("free", env)?.apiKey, "free-test-key");
	assert.equal(resolveSemanticEmbeddingRoute("pro", env)?.apiKey, "legacy-paid-test-key");
});

test("rejects dimensions that do not match the tier-aware vector schema", () => {
	assert.equal(
		resolveSemanticEmbeddingRoute("free", {
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_FREE_EMBEDDING_BASE_URL: "https://api.cloudflare.test/client/v4/accounts/account/ai/v1",
			AIRA_FREE_EMBEDDING_API_KEY: "free-test-key",
			AIRA_FREE_EMBEDDING_DIMENSIONS: "1536",
		}),
		null,
	);
	assert.equal(
		resolveSemanticEmbeddingRoute("pro", {
			SEMANTIC_MEMORY_ENABLED: "true",
			AIRA_PRO_EMBEDDING_API_KEY: "pro-test-key",
			AIRA_PRO_EMBEDDING_DIMENSIONS: "1024",
		}),
		null,
	);
});

test("Cloudflare BGE inputs are preserved without Nomic-specific task prefixes", () => {
	const route = {
		providerId: "cloudflare" as const,
		model: "@cf/baai/bge-base-en-v1.5",
	};
	assert.equal(formatSemanticEmbeddingInput(route, " where is Tokyo? ", "query"), "where is Tokyo?");
	assert.equal(formatSemanticEmbeddingInput(route, " Tokyo is in Japan. ", "document"), "Tokyo is in Japan.");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function source(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("persistent semantic memory resolves the authenticated owner tier before embedding", () => {
	const text = source("lib/persistent-memory.ts");
	assert.match(text, /resolveSemanticEmbeddingRouteForUser\(args\.userId\)/);
	assert.match(text, /resolveSemanticEmbeddingRouteForUser\(userId\)/);
	assert.match(text, /route,\s*\n\s*\}\)/);
	assert.doesNotMatch(text, /semanticMemoryConfigured\(\)/);
});

test("knowledge ingestion and recall use the same server-side user tier policy", () => {
	const text = source("lib/knowledge-assets.ts");
	assert.match(text, /resolveSemanticEmbeddingRouteForUser\(userId\)/);
	assert.match(text, /prepareChunkRows\(args\.userId, args\.chunks\)/);
	assert.match(text, /KnowledgeChunkSemanticEmbedding/);
	assert.match(text, /kse\.tier = \$\{route\.tier\}/);
	assert.match(text, /kse\.provider = \$\{route\.providerId\}/);
	assert.match(text, /kse\.model = \$\{route\.model\}/);
	assert.doesNotMatch(text, /AIRA_EMBEDDING_DIMENSIONS/);
});

test("tier-aware vector migration keeps model spaces separate without changing canonical memory", () => {
	const migration = readFileSync(
		path.join(REPO_ROOT, "prisma/migrations/20260824_tiered_semantic_embeddings/migration.sql"),
		"utf8",
	);
	assert.match(migration, /UserMemorySemanticEmbedding/);
	assert.match(migration, /KnowledgeChunkSemanticEmbedding/);
	assert.match(migration, /embedding extensions\.vector\(768\)/);
	assert.match(migration, /primary key \("memoryId", tier\)/);
	assert.match(migration, /primary key \("chunkId", tier\)/);
	assert.match(migration, /tier in \('free', 'pro'\)/);
	assert.match(migration, /enable row level security/);
	assert.match(migration, /deny_direct_data_api_access/);
	assert.doesNotMatch(migration, /drop table/i);
	assert.doesNotMatch(migration, /alter table public\."UserMemory"/i);
});

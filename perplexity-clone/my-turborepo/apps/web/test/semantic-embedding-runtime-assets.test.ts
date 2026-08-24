import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function repoSource(relativePath: string): string {
	return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function webSource(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("FREE embedding runtime is Cloudflare Workers AI at 768 dimensions", () => {
	const policy = webSource("lib/semantic-embedding-policy.ts");
	const docs = repoSource("infra/semantic-embedding/README.md");
	assert.match(policy, /DEFAULT_FREE_EMBEDDING_MODEL = "@cf\/baai\/bge-base-en-v1\.5"/);
	assert.match(policy, /providerId !== "cloudflare"/);
	assert.match(policy, /AIRA_FREE_EMBEDDING_BASE_URL/);
	assert.match(policy, /AIRA_FREE_EMBEDDING_API_KEY/);
	assert.match(policy, /SEMANTIC_EMBEDDING_DIMENSIONS = 768/);
	assert.match(docs, /api\.cloudflare\.com\/client\/v4\/accounts\/<ACCOUNT_ID>\/ai\/v1/);
	assert.doesNotMatch(policy, /OPENAI_API_KEY/);
});

test("FREE route stays isolated from paid semantic credentials", () => {
	const policy = webSource("lib/semantic-embedding-policy.ts");
	const freeBlock = policy.slice(policy.indexOf('if (tier === "free")'), policy.indexOf('const providerId = value(env, "AIRA_PRO_EMBEDDING_PROVIDER")'));
	assert.doesNotMatch(freeBlock, /AIRA_PRO_EMBEDDING_API_KEY|AIRA_EMBEDDING_API_KEY|OPENAI_API_KEY/);
	assert.match(freeBlock, /if \(!baseURL \|\| !apiKey \|\| dimensions === null\) return null/);
});

test("Cloudflare BGE requests use a conservative input bound", () => {
	const semantic = webSource("lib/semantic-memory.ts");
	assert.match(semantic, /route\.providerId === "cloudflare" \? 1_200 : 12_000/);
	assert.match(semantic, /request_too_large/);
});

test("endpoint verifier requires HTTPS, auth rejection and a 768-dimensional finite vector", () => {
	const verifier = repoSource("infra/semantic-embedding/scripts/verify_endpoint.py");
	assert.match(verifier, /DEFAULT_MODEL = "@cf\/baai\/bge-base-en-v1\.5"/);
	assert.match(verifier, /EXPECTED_DIMENSIONS = 768/);
	assert.match(verifier, /startswith\("https:\/\/"\)/);
	assert.match(verifier, /Authorization.*Bearer/);
	assert.match(verifier, /exc\.code in \{401, 403\}/);
	assert.match(verifier, /math\.isfinite/);
	assert.match(verifier, /token_printed=NO/);
	assert.match(verifier, /vector_printed=NO/);
});

test("semantic embedding telemetry is route-only and never logs user text or credentials", () => {
	const semantic = webSource("lib/semantic-memory.ts");
	assert.match(semantic, /\[AIRA semantic embedding\] request complete/);
	assert.match(semantic, /\[AIRA semantic embedding\] request failed/);
	assert.match(semantic, /workload: args\.workload/);
	assert.match(semantic, /failureClass: semanticEmbeddingFailureClass/);
	const telemetryBlock = semantic.slice(
		semantic.indexOf("function logSemanticEmbeddingAttempt"),
		semantic.indexOf("export function semanticEmbeddingVectorLiteral"),
	);
	assert.doesNotMatch(telemetryBlock, /userId|apiKey|input|text|query|content|authorization|cookie/i);
});

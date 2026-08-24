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

test("FREE route stays isolated from paid semantic credentials and requires HTTPS", () => {
	const policy = webSource("lib/semantic-embedding-policy.ts");
	const freeBlock = policy.slice(
		policy.indexOf('if (tier === "free")'),
		policy.indexOf('const providerId = value(env, "AIRA_PRO_EMBEDDING_PROVIDER")'),
	);
	assert.doesNotMatch(freeBlock, /AIRA_PRO_EMBEDDING_API_KEY|AIRA_EMBEDDING_API_KEY|OPENAI_API_KEY/);
	assert.match(freeBlock, /baseURL\.startsWith\("https:\/\/"\)/);
	assert.match(freeBlock, /!apiKey \|\| dimensions === null/);
});

test("Cloudflare BGE requests use the proven minimal request shape and bounded input", () => {
	const semantic = webSource("lib/semantic-memory.ts");
	assert.match(semantic, /route\.providerId === "cloudflare" \? 1_200 : 12_000/);
	const requestBlock = semantic.slice(
		semantic.indexOf("clientForRoute(route).embeddings.create"),
		semantic.indexOf("const vector = response.data[0]?.embedding"),
	);
	assert.match(requestBlock, /model: route\.model/);
	assert.match(requestBlock, /input/);
	assert.match(requestBlock, /route\.providerId === "openai"/);
	assert.match(requestBlock, /encoding_format: "float"/);
	assert.match(requestBlock, /dimensions: route\.dimensions/);
	assert.match(semantic, /status === 413\) return "request_too_large"/);
	assert.match(semantic, /status === 429\) return "rate_limit"/);
});

test("manual memory write awaits the semantic sidecar before returning", () => {
	const persistent = webSource("lib/persistent-memory.ts");
	const manualBlock = persistent.slice(persistent.indexOf("export async function createManualMemory"));
	assert.match(manualBlock, /const route = await resolveSemanticEmbeddingRouteForUser\(args\.userId\)/);
	assert.match(manualBlock, /await upsertUserMemoryEmbedding\(/);
	assert.doesNotMatch(manualBlock, /void resolveSemanticEmbeddingRouteForUser/);
	assert.match(manualBlock, /lexical memory remains available/);
});

test("Preview OAuth stays on Vercel's stable branch URL while Production is untouched", () => {
	const auth = webSource("auth.ts");
	const signInPage = webSource("app/signin/page.tsx");
	assert.match(auth, /process\.env\.VERCEL_ENV !== "preview"/);
	assert.match(auth, /process\.env\.VERCEL_BRANCH_URL/);
	assert.match(auth, /process\.env\.AUTH_URL = resolvedPreviewAuthUrl/);
	assert.match(auth, /process\.env\.NEXTAUTH_URL = resolvedPreviewAuthUrl/);
	assert.match(auth, /previewAuthUrlOverride: !!resolvedPreviewAuthUrl/);
	assert.match(signInPage, /function previewCanonicalOrigin\(\)/);
	assert.match(signInPage, /process\.env\.VERCEL_ENV !== "preview"/);
	assert.match(signInPage, /process\.env\.VERCEL_BRANCH_URL/);
	assert.match(signInPage, /const previewOrigin = previewCanonicalOrigin\(\)/);
	assert.match(signInPage, /if \(previewOrigin\) return previewOrigin/);
	assert.ok(
		signInPage.indexOf("if (previewOrigin) return previewOrigin") < signInPage.indexOf("process.env.AUTH_URL"),
		"Preview branch origin must win before Production AUTH_URL/NEXTAUTH_URL",
	);
});

test("Turborepo exposes every tiered semantic and Preview auth environment variable to the web build", () => {
	const turbo = JSON.parse(repoSource("turbo.json")) as { globalEnv?: string[] };
	const globalEnv = new Set(turbo.globalEnv ?? []);
	for (const name of [
		"VERCEL_BRANCH_URL",
		"SEMANTIC_MEMORY_ENABLED",
		"AIRA_FREE_EMBEDDING_PROVIDER",
		"AIRA_FREE_EMBEDDING_BASE_URL",
		"AIRA_FREE_EMBEDDING_API_KEY",
		"AIRA_FREE_EMBEDDING_MODEL",
		"AIRA_FREE_EMBEDDING_DIMENSIONS",
		"AIRA_PRO_EMBEDDING_PROVIDER",
		"AIRA_PRO_EMBEDDING_BASE_URL",
		"AIRA_PRO_EMBEDDING_API_KEY",
		"AIRA_PRO_EMBEDDING_MODEL",
		"AIRA_PRO_EMBEDDING_DIMENSIONS",
	]) {
		assert.ok(globalEnv.has(name), `${name} must be declared in turbo.json globalEnv`);
	}
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

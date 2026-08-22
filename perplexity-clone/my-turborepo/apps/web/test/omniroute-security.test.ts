import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function collectTextFiles(root: string): string[] {
	const results: string[] = [];
	const skip = new Set([".git", ".next", "node_modules", "generated", ".turbo"]);
	const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".json", ".ps1", ".yml", ".yaml", ".toml"]);
	function walk(current: string) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (skip.has(entry.name)) continue;
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name === ".env.example" || extensions.has(path.extname(entry.name))) {
				if (statSync(absolute).size <= 2 * 1024 * 1024) results.push(absolute);
			}
		}
	}
	walk(root);
	return results;
}

test("OmniRoute API routes require an authenticated AIRA session outside preview test mode", () => {
	for (const route of [
		"app/api/omniroute/status/route.ts",
		"app/api/omniroute/models/route.ts",
		"app/api/omniroute/test/route.ts",
	]) {
		const source = read(route);
		assert.ok(source.includes("isOmniRoutePreviewTestAccessEnabled()"), `${route} must gate preview access explicitly`);
		assert.ok(source.includes("await auth()"), `${route} must authenticate outside preview test mode`);
		assert.ok(source.includes("UNAUTHENTICATED"), `${route} must fail closed for signed-out users`);
		assert.ok(source.includes("status: 401"), `${route} must return HTTP 401 when signed out`);
		assert.ok(
			source.indexOf("isOmniRoutePreviewTestAccessEnabled()") < source.indexOf("await auth()"),
			`${route} must evaluate the preview gate before invoking Auth.js`,
		);
	}
});

test("OmniRoute preview test bypass is explicit, preview-only, and runs before Auth.js", () => {
	const helper = read("lib/omniroute-preview-access.ts");
	const proxy = read("proxy.ts");
	const layout = read("app/layout.tsx");
	const providers = read("app/providers.tsx");
	assert.ok(helper.includes('process.env.VERCEL_ENV === "preview"'));
	assert.ok(helper.includes('process.env.OMNIROUTE_PREVIEW_TEST_BYPASS === "true"'));
	assert.ok(proxy.includes('pathname === "/omniroute" || pathname.startsWith("/api/omniroute/")'));
	assert.ok(proxy.includes("const authenticatedProxy = auth("));
	assert.ok(proxy.includes("return (authenticatedProxy as unknown as NextMiddleware)(req, event)"));
	assert.ok(
		proxy.indexOf("isOmniRoutePreviewTestAccessEnabled()") <
			proxy.lastIndexOf("return (authenticatedProxy as NextMiddleware)(req, event)"),
	);
	assert.ok(layout.includes("disableAuth={previewTestAccess}"));
	assert.ok(providers.includes("if (disableAuth) return"));
	assert.ok(!helper.includes('VERCEL_ENV === "production"'));
});

test("OmniRoute credentials remain server-only", () => {
	const env = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
	const page = read("app/omniroute/page.tsx");
	assert.ok(env.includes("OMNIROUTE_API_KEY="));
	assert.ok(!env.includes("NEXT_PUBLIC_OMNIROUTE"));
	assert.ok(!page.includes("process.env.OMNIROUTE_API_KEY"));
	assert.ok(!page.includes("NEXT_PUBLIC_OMNIROUTE"));
});

test("gateway transport disables hidden SDK retries and applies a timeout", () => {
	const provider = read("src/services/providers/omniroute-provider.ts");
	assert.ok(provider.includes("maxRetries: 0"));
	assert.ok(provider.includes("timeout: timeoutMs"));
	assert.ok(provider.includes("signal: options.abortSignal"));
	assert.ok(provider.includes("inference_success"));
	assert.ok(provider.includes("inference_failure"));
	assert.ok(!provider.includes("JSON.stringify(messages)"));
	assert.ok(!provider.includes("Authorization"), "provider observability must never construct or log an authorization header");
});

test("live inference tests are bounded, safety-checked, authenticated and rate-limited", () => {
	const source = read("app/api/omniroute/test/route.ts");
	assert.ok(source.includes("RATE_LIMIT = 6"));
	assert.ok(source.includes("Retry-After"));
	assert.ok(source.includes('assertSafetyAllowed("input"'));
	assert.ok(source.includes('assertSafetyAllowed("output"'));
	assert.ok(source.includes("MAX_TEST_OUTPUT_CHARS"));
	assert.ok(source.includes("OMNIROUTE_MODEL_NOT_DISCOVERED"));
});

test("compare supports multiple distinct OmniRoute models or routing modes", () => {
	const api = read("app/api/compare/route.ts");
	const page = read("app/compare/page.tsx");
	assert.ok(api.includes("targets: z.array(TargetSchema).min(2).max(3)"));
	assert.ok(api.includes("DUPLICATE_TARGET"));
	assert.ok(api.includes("fetchOmniRouteModels"));
	assert.ok(page.includes("omniroute:auto/smart"));
	assert.ok(page.includes("omniroute:auto/fast"));
	assert.ok(page.includes("targets: selectedChoices.map"));
});

test("retired self-hosted/local runtime identifiers are absent from repository source", () => {
	const forbidden = [
		"SELF_" + "HOSTED_LLM",
		"VIREXA_" + "LOCAL_AI",
		"Browser" + "LlamaCppBridge",
		"/api/" + "local-ai",
	];
	const offenders: string[] = [];
	for (const absolute of collectTextFiles(REPO_ROOT)) {
		const relative = path.relative(REPO_ROOT, absolute).replaceAll(path.sep, "/");
		if (relative.endsWith("test/omniroute-security.test.ts")) continue;
		const source = readFileSync(absolute, "utf8");
		for (const token of forbidden) {
			if (source.includes(token)) offenders.push(`${relative}: ${token}`);
		}
	}
	assert.deepEqual(offenders, []);
});

test("the retired /local-ai route is only a compatibility redirect", () => {
	const source = read("app/local-ai/page.tsx");
	assert.ok(source.includes('redirect("/omniroute")'));
	assert.ok(!source.includes("AiraV2Frame"));
});

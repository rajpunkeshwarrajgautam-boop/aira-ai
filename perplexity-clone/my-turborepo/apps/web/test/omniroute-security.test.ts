import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

test("OmniRoute API routes always require an authenticated AIRA session", () => {
	const routes = [
		"app/api/omniroute/status/route.ts",
		"app/api/omniroute/models/route.ts",
		"app/api/omniroute/test/route.ts",
	];

	for (const route of routes) {
		const source = read(route);

		const authIndex = source.indexOf("await auth()");
		const unauthorizedIndex = source.indexOf("UNAUTHENTICATED");

		assert.ok(authIndex >= 0, `${route} must authenticate with Auth.js`);
		assert.ok(
			source.includes("status: 401"),
			`${route} must return HTTP 401 for a signed-out request`,
		);
		assert.ok(
			unauthorizedIndex > authIndex,
			`${route} must fail closed after evaluating the authenticated session`,
		);

		const protectedWorkMarker = route.endsWith("/test/route.ts")
			? "checkRateLimit(userId)"
			: "getOmniRouteConfigOrDisabled()";

		const protectedWorkIndex = source.indexOf(protectedWorkMarker);

		assert.ok(
			protectedWorkIndex > unauthorizedIndex,
			`${route} must reject signed-out requests before protected OmniRoute work begins`,
		);
	}
});

test("the retired OmniRoute Preview access mechanism is absent from runtime and operator source", () => {
	const retiredTokens = [
		"OMNIROUTE_" + "PREVIEW_TEST_BYPASS",
		"isOmniRoute" + "PreviewTestAccessEnabled",
		"omniroute-" + "preview-access",
		"preview" + "TestAccess",
		"disable" + "Auth",
		"preview-" + "omniroute-tester",
	];

	const offenders: string[] = [];

	for (const absolute of collectTextFiles(REPO_ROOT)) {
		const relative = path.relative(REPO_ROOT, absolute).replaceAll(path.sep, "/");

		if (relative.endsWith("test/omniroute-security.test.ts")) {
			continue;
		}

		const source = readFileSync(absolute, "utf8");

		for (const token of retiredTokens) {
			if (source.includes(token)) {
				offenders.push(`${relative}: ${token}`);
			}
		}
	}

	assert.deepEqual(
		offenders,
		[],
		"retired OmniRoute Preview-access identifiers must not exist in repository runtime/operator source",
	);

	const retiredHelper = path.join(
		WEB_ROOT,
		"lib",
		"omniroute-" + "preview-access.ts",
	);

	assert.equal(
		existsSync(retiredHelper),
		false,
		"the retired OmniRoute Preview-access helper must remain deleted",
	);

	const proxy = read("proxy.ts");
	const layout = read("app/layout.tsx");
	const providers = read("app/providers.tsx");

	assert.ok(
		proxy.includes("const authenticatedProxy = auth("),
		"proxy must retain the normal Auth.js middleware",
	);
	assert.ok(
		proxy.includes(
			"return (authenticatedProxy as unknown as NextMiddleware)(req, event)",
		),
		"proxy must delegate through authenticated Auth.js middleware",
	);
	assert.ok(
		layout.includes("<Providers>{children}</Providers>"),
		"RootLayout must always use normal application Providers",
	);
	assert.ok(
		providers.includes("<SessionProvider"),
		"Providers must retain the Auth.js SessionProvider",
	);
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
	assert.ok(page.includes("const targets = selectedChoices.map"));
	assert.ok(page.includes("body: JSON.stringify({ prompt: prompt.trim(), targets })"));
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

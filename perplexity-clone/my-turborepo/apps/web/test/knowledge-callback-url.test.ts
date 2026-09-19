import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

import { knowledgeCallbackUrl } from "../lib/knowledge-callback-auth";
import { suppressFixedAuthUrlOnPreview } from "../lib/auth-origin";
import { getConfiguredTrustedOrigins } from "../lib/request-integrity";

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	delete env.AUTH_URL;
	delete env.NEXTAUTH_URL;
	delete env.VERCEL_BRANCH_URL;
	delete env.VERCEL_URL;
	delete env.VERCEL_PROJECT_PRODUCTION_URL;
	delete env.VERCEL_ENV;
	delete env.NODE_ENV;
});

afterEach(() => {
	for (const key of Object.keys(process.env)) {
		if (!(key in ORIGINAL_ENV)) {
			delete env[key];
		}
	}
	Object.assign(process.env, ORIGINAL_ENV);
});

test("1. Stable Preview branch callback resolves correctly", () => {
	process.env.VERCEL_BRANCH_URL = "aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app";
	const callback = knowledgeCallbackUrl();
	assert.strictEqual(
		callback,
		"https://aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app/api/knowledge/callback",
	);
});

test("2. Deployment-specific Preview callback resolves when branch URL is unavailable", () => {
	process.env.VERCEL_URL = "aira-ai-live-dpl-xyz123-rajpunkeshwarrajgautam-boops-projects.vercel.app";
	const callback = knowledgeCallbackUrl();
	assert.strictEqual(
		callback,
		"https://aira-ai-live-dpl-xyz123-rajpunkeshwarrajgautam-boops-projects.vercel.app/api/knowledge/callback",
	);
});

test("3. Production callback remains unchanged using AUTH_URL", () => {
	env.NODE_ENV = "production";
	process.env.AUTH_URL = "https://aira-ai-live.vercel.app";
	const callback = knowledgeCallbackUrl();
	assert.strictEqual(callback, "https://aira-ai-live.vercel.app/api/knowledge/callback");
});

test("4. Preview does not require AUTH_URL or NEXTAUTH_URL", () => {
	process.env.VERCEL_ENV = "preview";
	process.env.VERCEL_BRANCH_URL = "aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app";

	// Simulate Auth.js suppressFixedAuthUrlOnPreview behavior
	suppressFixedAuthUrlOnPreview(process.env);

	assert.strictEqual(process.env.AUTH_URL, undefined);
	assert.strictEqual(process.env.NEXTAUTH_URL, undefined);

	const callback = knowledgeCallbackUrl();
	assert.strictEqual(
		callback,
		"https://aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app/api/knowledge/callback",
	);
});

test("5. Malformed configured URLs fail closed to null", () => {
	process.env.VERCEL_BRANCH_URL = "not a valid url with spaces";
	assert.strictEqual(knowledgeCallbackUrl(), null);

	process.env.VERCEL_BRANCH_URL = "javascript:alert(1)";
	assert.strictEqual(knowledgeCallbackUrl(), null);

	process.env.VERCEL_BRANCH_URL = "ftp://malicious.host/path";
	assert.strictEqual(knowledgeCallbackUrl(), null);

	process.env.VERCEL_BRANCH_URL = "path\\traversal\\attempt";
	assert.strictEqual(knowledgeCallbackUrl(), null);
});

test("6. Arbitrary external origins with userinfo or unconfigured environments fail closed", () => {
	// Attacker trying userinfo credential injection
	process.env.AUTH_URL = "https://user:password@evil.attacker.com";
	assert.strictEqual(knowledgeCallbackUrl(), null);

	// Completely empty configuration
	delete env.AUTH_URL;
	delete env.NEXTAUTH_URL;
	delete env.VERCEL_BRANCH_URL;
	delete env.VERCEL_URL;
	assert.strictEqual(knowledgeCallbackUrl(), null);
});

test("7. No Google OAuth regression: suppressFixedAuthUrlOnPreview maintains origin suppression on preview", () => {
	process.env.VERCEL_ENV = "preview";
	process.env.AUTH_URL = "https://production.example.com";
	process.env.NEXTAUTH_URL = "https://production.example.com";

	const suppressed = suppressFixedAuthUrlOnPreview(process.env);
	assert.strictEqual(suppressed, true);
	assert.strictEqual(process.env.AUTH_URL, undefined);
	assert.strictEqual(process.env.NEXTAUTH_URL, undefined);

	// But in production it is NOT suppressed
	env.NODE_ENV = "production";
	env.VERCEL_ENV = "production";
	process.env.AUTH_URL = "https://aira-ai-live.vercel.app";
	const prodSuppressed = suppressFixedAuthUrlOnPreview(process.env);
	assert.strictEqual(prodSuppressed, false);
	assert.strictEqual(process.env.AUTH_URL, "https://aira-ai-live.vercel.app");
});

test("8. Existing request-integrity behavior remains intact", () => {
	process.env.VERCEL_BRANCH_URL = "aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app";
	const { origins, isConfigured } = getConfiguredTrustedOrigins();

	assert.strictEqual(isConfigured, true);
	assert.ok(origins.has("https://aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app"));
	assert.ok(!origins.has("https://evil.com"));
});

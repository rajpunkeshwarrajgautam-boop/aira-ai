import assert from "node:assert/strict";
import test from "node:test";

import {
	getConfiguredTrustedOrigins,
	validateMutationRequestIntegrity,
} from "../lib/request-integrity";

const PREVIEW_BRANCH_HOST = "aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app";
const PREVIEW_DEPLOYMENT_HOST = "aira-ai-live-luoqsow71-rajpunkeshwarrajgautam-boops-projects.vercel.app";
const PRODUCTION_HOST = "aira-ai-live.vercel.app";

function withEnv<T>(envOverrides: Record<string, string | undefined>, fn: () => T): T {
	const originalEnv = { ...process.env };
	for (const [k, v] of Object.entries(envOverrides)) {
		if (v === undefined) {
			delete process.env[k];
		} else {
			process.env[k] = v;
		}
	}
	try {
		return fn();
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key];
			}
		}
		Object.assign(process.env, originalEnv);
	}
}

test("1. Exact configured VERCEL_BRANCH_URL accepted as trusted target and source origin", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
			AUTH_URL: undefined,
			NEXTAUTH_URL: undefined,
		},
		() => {
			const { origins, isConfigured } = getConfiguredTrustedOrigins();
			assert.equal(isConfigured, true);
			assert.ok(origins.has(`https://${PREVIEW_BRANCH_HOST}`));

			const req = new Request(`https://${PREVIEW_BRANCH_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: `https://${PREVIEW_BRANCH_HOST}`,
				},
				body: JSON.stringify({ content: "test" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, true);
			assert.equal(result.response, undefined);
		},
	);
});

test("2. Exact configured VERCEL_URL accepted as trusted target and source origin", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
			AUTH_URL: undefined,
			NEXTAUTH_URL: undefined,
		},
		() => {
			const req = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: `https://${PREVIEW_DEPLOYMENT_HOST}`,
				},
				body: JSON.stringify({ content: "test" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, true);
		},
	);
});

test("3. Existing Production origin accepted", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "production",
			VERCEL_URL: PRODUCTION_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
			AUTH_URL: `https://${PRODUCTION_HOST}`,
			NEXTAUTH_URL: `https://${PRODUCTION_HOST}`,
			VERCEL_BRANCH_URL: undefined,
		},
		() => {
			const req = new Request(`https://${PRODUCTION_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: `https://${PRODUCTION_HOST}`,
				},
				body: JSON.stringify({ content: "test" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, true);
		},
	);
});

test("4. Unrelated Vercel deployment rejected with 403 CSRF_REJECTED", async () => {
	await withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
			AUTH_URL: undefined,
			NEXTAUTH_URL: undefined,
		},
		async () => {
			const req = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://attacker-deployment.vercel.app",
				},
				body: JSON.stringify({ content: "evil" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, false);
			assert.ok(result.response);
			assert.equal(result.response.status, 403);
			const body = (await result.response.json()) as { error: { code: string } };
			assert.equal(body.error.code, "CSRF_REJECTED");
		},
	);
});

test("5. Attacker-controlled external origin rejected with 403 CSRF_REJECTED", async () => {
	await withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
		},
		async () => {
			const req = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "https://evil.example.com",
				},
				body: JSON.stringify({ content: "evil" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, false);
			assert.ok(result.response);
			assert.equal(result.response.status, 403);
			const body = (await result.response.json()) as { error: { code: string } };
			assert.equal(body.error.code, "CSRF_REJECTED");
		},
	);
});

test("6. Lookalike subdomain rejected with 403 CSRF_REJECTED", async () => {
	await withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
		},
		async () => {
			const req = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: `https://${PREVIEW_DEPLOYMENT_HOST}.attacker.com`,
				},
				body: JSON.stringify({ content: "evil" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, false);
			assert.ok(result.response);
			assert.equal(result.response.status, 403);
		},
	);
});

test("7. Target/source origin mismatch rejected (cross-origin attack)", async () => {
	await withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
		},
		async () => {
			const req = new Request("https://attacker-target.com/api/memory", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: `https://${PREVIEW_DEPLOYMENT_HOST}`,
				},
				body: JSON.stringify({ content: "test" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, false);
			assert.ok(result.response);
			assert.equal(result.response.status, 403);
			const body = (await result.response.json()) as { error: { code: string; message: string } };
			assert.equal(body.error.code, "CSRF_REJECTED");
			assert.equal(body.error.message, "Untrusted request target origin.");
		},
	);
});

test("8. Invalid Content-Type rejected with 415 UNSUPPORTED_MEDIA_TYPE", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
		},
		() => {
			const req1 = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					origin: `https://${PREVIEW_DEPLOYMENT_HOST}`,
				},
				body: JSON.stringify({ content: "test" }),
			});
			const res1 = validateMutationRequestIntegrity(req1);
			assert.equal(res1.valid, false);
			assert.equal(res1.response?.status, 415);

			const req2 = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "text/plain",
					origin: `https://${PREVIEW_DEPLOYMENT_HOST}`,
				},
				body: "test",
			});
			const res2 = validateMutationRequestIntegrity(req2);
			assert.equal(res2.valid, false);
			assert.equal(res2.response?.status, 415);
		},
	);
});

test("9. Malformed or wildcard configured URLs do not broaden trust", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: "https://*.vercel.app",
			VERCEL_BRANCH_URL: "ftp://invalid-protocol.com",
			VERCEL_PROJECT_PRODUCTION_URL: "user:pass@evil.com",
			AUTH_URL: "javascript:alert(1)",
			NEXTAUTH_URL: "",
		},
		() => {
			const { origins } = getConfiguredTrustedOrigins();
			for (const origin of origins) {
				assert.ok(!origin.includes("*"));
				assert.ok(origin.startsWith("http://") || origin.startsWith("https://"));
				assert.ok(!origin.includes("@"));
			}
			assert.equal(origins.has("https://*.vercel.app"), false);
			assert.equal(origins.has("ftp://invalid-protocol.com"), false);
			assert.equal(origins.has("javascript:alert(1)"), false);
		},
	);
});

test("10. Referer header fallback works when Origin header is omitted", () => {
	withEnv(
		{
			NODE_ENV: "production",
			VERCEL_ENV: "preview",
			VERCEL_URL: PREVIEW_DEPLOYMENT_HOST,
			VERCEL_BRANCH_URL: PREVIEW_BRANCH_HOST,
			VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_HOST,
		},
		() => {
			const req = new Request(`https://${PREVIEW_DEPLOYMENT_HOST}/api/memory`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					referer: `https://${PREVIEW_DEPLOYMENT_HOST}/memory`,
				},
				body: JSON.stringify({ content: "test" }),
			});

			const result = validateMutationRequestIntegrity(req);
			assert.equal(result.valid, true);
		},
	);
});

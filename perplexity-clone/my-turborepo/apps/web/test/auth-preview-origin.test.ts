import assert from "node:assert/strict";
import test from "node:test";

import {
	isTrustedAuthRequestUrl,
	runtimeTrustedAuthOrigins,
	safeAuthRedirect,
	safeAuthReturnPath,
	suppressFixedAuthUrlOnPreview,
	trustedAuthRequestHeaders,
} from "../lib/auth-origin";

const PREVIEW_HOST = "aira-ai-live-preview-123-owner.vercel.app";
const BRANCH_HOST = "aira-ai-live-git-integration-owner.vercel.app";
const PRODUCTION_ORIGIN = "https://aira-ai-live.vercel.app";

function previewEnv() {
	return {
		NODE_ENV: "production",
		VERCEL: "1",
		VERCEL_ENV: "preview",
		VERCEL_URL: PREVIEW_HOST,
		VERCEL_BRANCH_URL: BRANCH_HOST,
		VERCEL_PROJECT_PRODUCTION_URL: "aira-ai-live.vercel.app",
		AUTH_URL: PRODUCTION_ORIGIN,
		NEXTAUTH_URL: PRODUCTION_ORIGIN,
	};
}

test("Preview suppresses a production-scoped fixed Auth.js URL without mutating production behavior", () => {
	const preview = previewEnv();
	assert.equal(suppressFixedAuthUrlOnPreview(preview), true);
	assert.equal(preview.AUTH_URL, undefined);
	assert.equal(preview.NEXTAUTH_URL, undefined);

	const production = {
		NODE_ENV: "production",
		VERCEL: "1",
		VERCEL_ENV: "production",
		VERCEL_URL: "aira-ai-live.vercel.app",
		VERCEL_PROJECT_PRODUCTION_URL: "aira-ai-live.vercel.app",
		AUTH_URL: PRODUCTION_ORIGIN,
		NEXTAUTH_URL: PRODUCTION_ORIGIN,
	};
	assert.equal(suppressFixedAuthUrlOnPreview(production), false);
	assert.equal(production.AUTH_URL, PRODUCTION_ORIGIN);
	assert.equal(production.NEXTAUTH_URL, PRODUCTION_ORIGIN);
});

test("Preview trusts only exact Vercel system hosts for this deployment/branch", () => {
	const env = previewEnv();
	const origins = runtimeTrustedAuthOrigins(env);
	assert.deepEqual(
		new Set(origins),
		new Set([`https://${PREVIEW_HOST}`, `https://${BRANCH_HOST}`]),
	);
	assert.equal(isTrustedAuthRequestUrl(`https://${PREVIEW_HOST}/work`, env), true);
	assert.equal(isTrustedAuthRequestUrl(`https://${BRANCH_HOST}/projects`, env), true);
	assert.equal(isTrustedAuthRequestUrl("https://attacker.vercel.app/work", env), false);
	assert.equal(isTrustedAuthRequestUrl(`${PRODUCTION_ORIGIN}/work`, env), false);
	assert.equal(
		isTrustedAuthRequestUrl(`https://${PREVIEW_HOST}.evil.example/work`, env),
		false,
	);
});

test("Host and X-Forwarded-Host spoofing are overwritten from the trusted request URL", () => {
	const env = previewEnv();
	const incoming = new Headers({
		host: "evil.example",
		"x-forwarded-host": "evil.example",
		"x-forwarded-proto": "http",
	});
	const normalized = trustedAuthRequestHeaders(
		`https://${PREVIEW_HOST}/api/auth/signin/google`,
		incoming,
		env,
	);
	assert.ok(normalized);
	assert.equal(normalized.get("host"), PREVIEW_HOST);
	assert.equal(normalized.get("x-forwarded-host"), PREVIEW_HOST);
	assert.equal(normalized.get("x-forwarded-proto"), "https");
	assert.equal(
		trustedAuthRequestHeaders("https://evil.example/api/auth/signin/google", incoming, env),
		null,
	);
});

test("server-side redirect policy permits only same-origin destinations", () => {
	const base = `https://${PREVIEW_HOST}`;
	assert.equal(safeAuthRedirect("/work", base), `${base}/work`);
	assert.equal(safeAuthRedirect(`${base}/projects?tab=runs`, base), `${base}/projects?tab=runs`);
	assert.equal(safeAuthRedirect("https://evil.example", base), base);
	assert.equal(safeAuthRedirect("//evil.example", base), base);
	assert.equal(safeAuthRedirect("javascript:alert(1)", base), base);
	assert.equal(safeAuthRedirect("data:text/html,hello", base), base);
	assert.equal(safeAuthRedirect(`${PRODUCTION_ORIGIN}.evil.example/work`, PRODUCTION_ORIGIN), PRODUCTION_ORIGIN);
	assert.equal(safeAuthRedirect("https://evil.example/?next=aira-ai-live.vercel.app", PRODUCTION_ORIGIN), PRODUCTION_ORIGIN);
});

test("client return targets preserve safe paths and reject external callback URLs", () => {
	const origin = `https://${PREVIEW_HOST}`;
	assert.equal(safeAuthReturnPath("/work", origin), "/work");
	assert.equal(safeAuthReturnPath("/projects?tab=runs#latest", origin), "/projects?tab=runs#latest");
	assert.equal(safeAuthReturnPath(`${origin}/work?mode=agent`, origin), "/work?mode=agent");
	assert.equal(safeAuthReturnPath("https://evil.example/work", origin), "/");
	assert.equal(safeAuthReturnPath("//evil.example/work", origin), "/");
	assert.equal(safeAuthReturnPath("/\\evil.example/work", origin), "/");
	assert.equal(safeAuthReturnPath("javascript:alert(1)", origin), "/");
	assert.equal(safeAuthReturnPath("data:text/html,hello", origin), "/");
	assert.equal(safeAuthReturnPath(`${origin}.evil.example/work`, origin), "/");
});

test("local development remains available without trusting arbitrary remote hosts", () => {
	const env = { NODE_ENV: "development" };
	assert.equal(isTrustedAuthRequestUrl("http://localhost:3000/work", env), true);
	assert.equal(isTrustedAuthRequestUrl("http://127.0.0.1:3000/work", env), true);
	assert.equal(isTrustedAuthRequestUrl("https://evil.example/work", env), false);
});

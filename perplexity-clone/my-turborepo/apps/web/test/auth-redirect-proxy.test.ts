import assert from "node:assert/strict";
import test from "node:test";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { NextRequest } from "next/server";

import { safeAuthRedirect, suppressFixedAuthUrlOnPreview } from "../lib/auth-origin";

const STABLE = "https://aira-ai.in";
const SECRET = "fixture-only-auth-proxy-secret-at-least-32-characters";
const PREVIEWS = ["https://aira-build-one.vercel.app", "https://aira-build-two.vercel.app"] as const;
const ENV_KEYS = ["AUTH_URL", "NEXTAUTH_URL", "AUTH_REDIRECT_PROXY_URL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

test.before(() => {
	// Fixed production URLs must not override the initiating Preview host.
	process.env.AUTH_URL = STABLE;
	process.env.NEXTAUTH_URL = STABLE;
	process.env.VERCEL_ENV = "preview";
	suppressFixedAuthUrlOnPreview(process.env);
	process.env.AUTH_REDIRECT_PROXY_URL = `${STABLE}/api/auth`;
});
const originalVercelEnv = process.env.VERCEL_ENV;
test.after(() => {
	for (const key of ENV_KEYS) {
		if (originalEnv[key] === undefined) delete process.env[key];
		else process.env[key] = originalEnv[key];
	}
	if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
	else process.env.VERCEL_ENV = originalVercelEnv;
});

function handlers(secret = SECRET) {
	return NextAuth({
		secret,
		trustHost: true,
		providers: [
			Google({
				clientId: "fixture-google-id", clientSecret: "fixture-google-secret",
				authorization: "https://accounts.google.com/o/oauth2/v2/auth",
			}),
			GitHub({ clientId: "fixture-github-id", clientSecret: "fixture-github-secret" }),
		],
		callbacks: { redirect: ({ url, baseUrl }) => safeAuthRedirect(url, baseUrl) },
		logger: { error() {}, warn() {}, debug() {} },
	}).handlers;
}

async function authorization(origin: string, provider: string) {
	const auth = handlers();
	const csrf = await auth.GET(new NextRequest(`${origin}/api/auth/csrf`));
	assert.equal(csrf.status, 200);
	const { csrfToken } = await csrf.json();
	const cookies = csrf.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
	const response = await auth.POST(new NextRequest(`${origin}/api/auth/signin/${provider}`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
		body: new URLSearchParams({ csrfToken, callbackUrl: `${origin}/work` }),
	}));
	assert.equal(response.status, 302);
	return { response, url: new URL(response.headers.get("location")!) };
}

for (const provider of ["google", "github"]) {
	for (const origin of PREVIEWS) {
		test(`${provider} uses one stable callback and returns encrypted state to ${origin}`, async () => {
			const { response, url } = await authorization(origin, provider);
			assert.equal(url.searchParams.get("redirect_uri"), `${STABLE}/api/auth/callback/${provider}`);
			const state = url.searchParams.get("state");
			assert.ok(state);
			assert.equal(state.includes(origin), false);
			const cookies = response.headers.getSetCookie();
			assert.ok(cookies.some((cookie) => cookie.startsWith("__Secure-authjs.state=")));
			assert.ok(cookies.every((cookie) => !/;\s*domain=/i.test(cookie)));
			if (provider === "google") {
				assert.equal(url.searchParams.get("code_challenge_method"), "S256");
				assert.ok(cookies.some((cookie) => cookie.startsWith("__Secure-authjs.pkce.code_verifier=")));
			}
			const callback = new URL(`${STABLE}/api/auth/callback/${provider}`);
			callback.search = new URLSearchParams({ code: "fixture-code", state }).toString();
			// The stable host needs no Preview cookie and does not exchange the code.
			const proxyResponse = await handlers().GET(new NextRequest(callback));
			assert.equal(proxyResponse.status, 302);
			const returned = new URL(proxyResponse.headers.get("location")!);
			assert.equal(returned.origin, origin);
			assert.equal(returned.pathname, `/api/auth/callback/${provider}`);
			assert.equal(returned.searchParams.get("state"), state);
			assert.equal(returned.searchParams.get("code"), "fixture-code");
		});
	}
}

test("stable-site login continues using its own callback", async () => {
	const { url } = await authorization(STABLE, "github");
	assert.equal(url.searchParams.get("redirect_uri"), `${STABLE}/api/auth/callback/github`);
});

test("proxy rejects state encrypted with a different secret", async () => {
	const { url } = await authorization(PREVIEWS[0], "github");
	const callback = new URL(`${STABLE}/api/auth/callback/github`);
	callback.search = new URLSearchParams({ code: "fixture-code", state: url.searchParams.get("state")! }).toString();
	const response = await handlers("different-fixture-secret-at-least-32-characters").GET(new NextRequest(callback));
	const destination = new URL(response.headers.get("location")!);
	assert.equal(destination.origin, STABLE);
	assert.equal(destination.searchParams.get("error"), "Configuration");
});

test("proxy rejects tampered state", async () => {
	const callback = new URL(`${STABLE}/api/auth/callback/google`);
	callback.search = new URLSearchParams({ code: "fixture-code", state: "https://attacker.example/callback" }).toString();
	const response = await handlers().GET(new NextRequest(callback));
	const destination = new URL(response.headers.get("location")!);
	assert.equal(destination.origin, STABLE);
	assert.equal(destination.searchParams.get("error"), "Configuration");
});

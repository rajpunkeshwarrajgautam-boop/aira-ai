import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	checkBrowserRateLimit,
	MAX_ACTIVE_SESSIONS_PER_USER,
	resetBrowserRateLimitsForTesting,
} from "../lib/browser-runtime/rate-limiter";
import { classifyToolRisk } from "../lib/tool-gateway/policy";
import { publicWebUrl } from "../lib/tool-gateway/web-security";

test("SSRF defense: publicWebUrl strictly blocks private, loopback, metadata, and non-http schemes", () => {
	const blocked = [
		"http://localhost",
		"http://localhost:8080",
		"http://127.0.0.1",
		"http://127.0.0.1:3000",
		"http://0.0.0.0",
		"http://10.0.0.1",
		"http://172.16.0.1",
		"http://192.168.1.1",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]",
		"file:///etc/passwd",
		"ftp://example.com",
		"javascript:alert(1)",
		"data:text/html,<h1>hi</h1>",
		"http://admin:secret@example.com",
	];

	for (const url of blocked) {
		assert.equal(publicWebUrl(url), null, `Expected ${url} to be blocked by publicWebUrl`);
	}

	const allowed = [
		"https://example.com",
		"https://example.com/path?param=1",
		"https://nextjs.org/docs",
		"http://example.org",
	];

	for (const url of allowed) {
		const parsed = publicWebUrl(url);
		assert.notEqual(parsed, null, `Expected ${url} to be allowed`);
	}
});

test("Browser action risk policy: mutating actions are HIGH risk; safe observations are LOW risk", () => {
	// Read actions
	assert.equal(classifyToolRisk("browser", "navigate"), "LOW");
	assert.equal(classifyToolRisk("browser", "inspect"), "LOW");
	assert.equal(classifyToolRisk("browser", "scroll"), "LOW");
	assert.equal(classifyToolRisk("browser", "wait"), "LOW");
	assert.equal(classifyToolRisk("browser", "hover"), "LOW");
	assert.equal(classifyToolRisk("browser", "back"), "LOW");
	assert.equal(classifyToolRisk("browser", "forward"), "LOW");
	assert.equal(classifyToolRisk("browser", "screenshot"), "LOW");

	// Consequential mutating actions must be HIGH risk requiring explicit human approval
	assert.equal(classifyToolRisk("browser", "click"), "HIGH");
	assert.equal(classifyToolRisk("browser", "double_click"), "HIGH");
	assert.equal(classifyToolRisk("browser", "click_at"), "HIGH");
	assert.equal(classifyToolRisk("browser", "fill"), "HIGH");
	assert.equal(classifyToolRisk("browser", "press"), "HIGH");
	assert.equal(classifyToolRisk("browser", "select"), "HIGH");
	assert.equal(classifyToolRisk("browser", "submit"), "HIGH");
});

test("Human/Agent action arbitration: actions route requires HUMAN_CONTROL and claims lease", () => {
	const actionsRoute = readFileSync(
		new URL("../app/api/browser/sessions/[sessionId]/actions/route.ts", import.meta.url),
		"utf8",
	);
	assert.match(actionsRoute, /record\.status !== "HUMAN_CONTROL"/);
	assert.match(actionsRoute, /BROWSER_AGENT_CONTROL/);
	assert.match(actionsRoute, /claimBrowserActionLease/);
	assert.match(actionsRoute, /source:\s*"USER"/);
	assert.match(actionsRoute, /releaseBrowserActionLease/);
	assert.match(actionsRoute, /source\s*=\s*"HUMAN"/);
	assert.match(actionsRoute, /publicWebUrl/);
});

test("Untrusted browser content wrapper: tool adapter encloses observations in isolation tags", () => {
	const adapterSource = readFileSync(
		new URL("../lib/tool-gateway/adapters.ts", import.meta.url),
		"utf8",
	);
	assert.match(adapterSource, /<aira_untrusted_browser_content/);
	assert.match(adapterSource, /UNTRUSTED EXTERNAL WEB CONTENT/);
	assert.match(adapterSource, /publicWebUrl/);
	assert.match(adapterSource, /observation:\s*untrustedWrapper/);
});

test("Action cancellation: endpoint calls remote cancel and releases active leases", () => {
	const cancelRoute = readFileSync(
		new URL("../app/api/browser/sessions/[sessionId]/cancel/route.ts", import.meta.url),
		"utf8",
	);
	assert.match(cancelRoute, /cancelRemoteBrowserAction/);
	assert.match(cancelRoute, /releaseBrowserActionLease/);
	assert.match(cancelRoute, /action:\s*"cancel"/);

	const clientSource = readFileSync(
		new URL("../lib/browser-runtime/client.ts", import.meta.url),
		"utf8",
	);
	assert.match(clientSource, /cancelRemoteBrowserAction/);
	assert.match(clientSource, /BROWSER_CANCELLED/);
	assert.match(clientSource, /BROWSER_TIMEOUT/);
});

test("Client timeout policy: default timeout is 35s to prevent premature client abort before worker", () => {
	const clientSource = readFileSync(
		new URL("../lib/browser-runtime/client.ts", import.meta.url),
		"utf8",
	);
	assert.match(clientSource, /DEFAULT_TIMEOUT_MS\s*=\s*35_000/);
});

test("Per-user rate limiter enforces bounds on sessions, actions, and screenshots", async () => {
	await resetBrowserRateLimitsForTesting();
	const testUser = `usr_test_${Date.now()}`;

	// Session create limit (5 / min)
	for (let i = 0; i < 5; i++) {
		const res = await checkBrowserRateLimit(testUser, "session_create");
		assert.equal(res.allowed, true, `Expected session_create ${i + 1} to be allowed`);
	}
	const sessionBlocked = await checkBrowserRateLimit(testUser, "session_create");
	assert.equal(sessionBlocked.allowed, false);
	assert.ok(sessionBlocked.retryAfter && sessionBlocked.retryAfter > 0);

	// Action limit (30 / min)
	for (let i = 0; i < 30; i++) {
		const res = await checkBrowserRateLimit(testUser, "action");
		assert.equal(res.allowed, true);
	}
	const actionBlocked = await checkBrowserRateLimit(testUser, "action");
	assert.equal(actionBlocked.allowed, false);

	// Max active sessions constant is strictly bounded
	assert.equal(MAX_ACTIVE_SESSIONS_PER_USER, 3);
	await resetBrowserRateLimitsForTesting();
});

test("Browser UI components provide Back, Forward, Cancel, and Go navigation controls", () => {
	const uiSource = readFileSync(
		new URL("../components/browser/BrowserWorkspace.tsx", import.meta.url),
		"utf8",
	);
	assert.match(uiSource, /action:\s*"back"/);
	assert.match(uiSource, /action:\s*"forward"/);
	assert.match(uiSource, /cancelAction/);
	assert.match(uiSource, /api\/browser\/sessions\/.*\/cancel/);
});

test("Dual-layer SSRF validation in session creation route", () => {
	const sessionsRoute = readFileSync(
		new URL("../app/api/browser/sessions/route.ts", import.meta.url),
		"utf8",
	);
	assert.match(sessionsRoute, /publicWebUrl/);
	assert.match(sessionsRoute, /MAX_ACTIVE_SESSIONS_PER_USER/);
	assert.match(sessionsRoute, /checkBrowserRateLimit/);
});

test("Session state reconciliation in GET session route", () => {
	const sessionDetailRoute = readFileSync(
		new URL("../app/api/browser/sessions/[sessionId]/route.ts", import.meta.url),
		"utf8",
	);
	assert.match(sessionDetailRoute, /status:\s*"EXPIRED"/);
	assert.match(sessionDetailRoute, /status:\s*"FAILED"/);
});

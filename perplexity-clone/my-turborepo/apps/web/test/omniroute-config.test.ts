import assert from "node:assert/strict";
import test from "node:test";

import {
	getOmniRouteConfigOrDisabled,
	normalizeOmniRouteBaseURL,
} from "../src/services/omniroute/config";

const KEYS = [
	"NODE_ENV",
	"OMNIROUTE_ENABLED",
	"OMNIROUTE_BASE_URL",
	"OMNIROUTE_API_KEY",
	"OMNIROUTE_MODEL",
	"OMNIROUTE_TIMEOUT_MS",
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, run: () => void) {
	const previous = new Map<string, string | undefined>();
	for (const key of KEYS) {
		previous.set(key, process.env[key]);
		const next = values[key];
		if (next === undefined) delete process.env[key];
		else process.env[key] = next;
	}
	try {
		run();
	} finally {
		for (const key of KEYS) {
			const value = previous.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("normalizes production OmniRoute origins to exactly one /v1 root", () => {
	assert.equal(normalizeOmniRouteBaseURL("https://route.example.com", "production"), "https://route.example.com/v1");
	assert.equal(normalizeOmniRouteBaseURL("https://route.example.com/", "production"), "https://route.example.com/v1");
	assert.equal(normalizeOmniRouteBaseURL("https://route.example.com/v1", "production"), "https://route.example.com/v1");
	assert.equal(normalizeOmniRouteBaseURL("https://route.example.com/v1/", "production"), "https://route.example.com/v1");
	assert.equal(normalizeOmniRouteBaseURL("   ", "production"), "");
});

test("allows plain HTTP only for development loopback gateways", () => {
	assert.equal(normalizeOmniRouteBaseURL("http://127.0.0.1:20128", "development"), "http://127.0.0.1:20128/v1");
	assert.equal(normalizeOmniRouteBaseURL("http://localhost:20128/v1/", "test"), "http://localhost:20128/v1");
	assert.throws(
		() => normalizeOmniRouteBaseURL("http://route.example.com", "development"),
		/only allowed on localhost or loopback/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("http://127.0.0.1:20128", "production"),
		/must use HTTPS in production/i,
	);
});

test("rejects credential-bearing, ambiguous, and malformed gateway URLs", () => {
	assert.throws(
		() => normalizeOmniRouteBaseURL("https://user:pass@route.example.com", "production"),
		/embedded credentials/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("https://route.example.com/v1?target=evil", "production"),
		/query string/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("https://route.example.com/v1#secret", "production"),
		/fragment/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("https://route.example.com/proxy/v1", "production"),
		/gateway origin or its \/v1 API root/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("not a url", "production"),
		/valid absolute URL/i,
	);
	assert.throws(
		() => normalizeOmniRouteBaseURL("file:///tmp/omniroute", "development"),
		/http or https/i,
	);
});

test("stays disabled until explicitly enabled", () => {
	withEnv(
		{
			NODE_ENV: "development",
			OMNIROUTE_ENABLED: "false",
			OMNIROUTE_BASE_URL: "http://127.0.0.1:20128",
			OMNIROUTE_API_KEY: "test-only",
		},
		() => {
			const config = getOmniRouteConfigOrDisabled();
			assert.equal(config.enabled, false);
			assert.equal(config.configured, false);
		},
	);
});

test("fails closed with a safe configuration error when an enabled production URL is invalid", () => {
	withEnv(
		{
			NODE_ENV: "production",
			OMNIROUTE_ENABLED: "true",
			OMNIROUTE_BASE_URL: "http://127.0.0.1:20128",
			OMNIROUTE_API_KEY: "test-only",
		},
		() => {
			const config = getOmniRouteConfigOrDisabled();
			assert.equal(config.enabled, true);
			assert.equal(config.configured, false);
			assert.equal(config.baseURL, "");
			assert.match(config.configurationError ?? "", /HTTPS in production/i);
			assert.ok(!(config.configurationError ?? "").includes("test-only"));
		},
	);
});

test("builds a configured development gateway with routing mode and bounded timeout", () => {
	withEnv(
		{
			NODE_ENV: "development",
			OMNIROUTE_ENABLED: "true",
			OMNIROUTE_BASE_URL: "http://127.0.0.1:20128",
			OMNIROUTE_API_KEY: "test-only",
			OMNIROUTE_MODEL: "auto/coding",
			OMNIROUTE_TIMEOUT_MS: "999999",
		},
		() => {
			const config = getOmniRouteConfigOrDisabled();
			assert.equal(config.enabled, true);
			assert.equal(config.configured, true);
			assert.equal(config.baseURL, "http://127.0.0.1:20128/v1");
			assert.equal(config.model, "auto/coding");
			assert.equal(config.timeoutMs, 120_000);
			assert.equal(config.configurationError, undefined);
		},
	);
});

test("defaults routing to auto and timeout to 45 seconds", () => {
	withEnv(
		{
			NODE_ENV: "production",
			OMNIROUTE_ENABLED: "true",
			OMNIROUTE_BASE_URL: "https://route.example.com/v1",
			OMNIROUTE_API_KEY: "test-only",
			OMNIROUTE_MODEL: undefined,
			OMNIROUTE_TIMEOUT_MS: undefined,
		},
		() => {
			const config = getOmniRouteConfigOrDisabled();
			assert.equal(config.configured, true);
			assert.equal(config.model, "auto");
			assert.equal(config.timeoutMs, 45_000);
		},
	);
});

test("clamps the configured timeout to one second minimum", () => {
	withEnv(
		{
			NODE_ENV: "production",
			OMNIROUTE_ENABLED: "true",
			OMNIROUTE_BASE_URL: "https://route.example.com",
			OMNIROUTE_API_KEY: "test-only",
			OMNIROUTE_TIMEOUT_MS: "10",
		},
		() => assert.equal(getOmniRouteConfigOrDisabled().timeoutMs, 1_000),
	);
});

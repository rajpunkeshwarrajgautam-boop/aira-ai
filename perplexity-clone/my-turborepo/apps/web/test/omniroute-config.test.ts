import assert from "node:assert/strict";
import test from "node:test";

import {
	getOmniRouteConfigOrDisabled,
	normalizeOmniRouteBaseURL,
} from "../src/services/omniroute/config";

const KEYS = [
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

test("normalizes OmniRoute base URLs to the OpenAI-compatible v1 root", () => {
	assert.equal(normalizeOmniRouteBaseURL("http://127.0.0.1:20128"), "http://127.0.0.1:20128/v1");
	assert.equal(normalizeOmniRouteBaseURL("https://route.example.com/v1/"), "https://route.example.com/v1");
	assert.equal(normalizeOmniRouteBaseURL("   "), "");
});

test("stays disabled until explicitly enabled", () => {
	withEnv(
		{
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

test("builds a configured gateway with routing mode and bounded timeout", () => {
	withEnv(
		{
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
		},
	);
});

test("defaults routing to auto and timeout to 45 seconds", () => {
	withEnv(
		{
			OMNIROUTE_ENABLED: "true",
			OMNIROUTE_BASE_URL: "http://127.0.0.1:20128/v1",
			OMNIROUTE_API_KEY: "test-only",
			OMNIROUTE_MODEL: undefined,
			OMNIROUTE_TIMEOUT_MS: undefined,
		},
		() => {
			const config = getOmniRouteConfigOrDisabled();
			assert.equal(config.model, "auto");
			assert.equal(config.timeoutMs, 45_000);
		},
	);
});

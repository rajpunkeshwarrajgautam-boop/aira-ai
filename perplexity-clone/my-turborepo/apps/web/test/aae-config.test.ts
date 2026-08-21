import assert from "node:assert/strict";
import test from "node:test";

import {
	AaeConfigError,
	getAaeConfig,
	isAaeConfigured,
	isAaeEnabled,
	isAaeUserAllowed,
} from "../lib/aae/config";

const MANAGED = [
	"AAE_AGENT_ENABLED",
	"AAE_API_BASE_URL",
	"AAE_INTERNAL_AUTH_TOKEN",
	"AAE_ALLOWED_USER_ID",
	"AAE_REQUEST_TIMEOUT_MS",
	"AAE_HEALTH_TIMEOUT_MS",
	"NODE_ENV",
] as const;

const mutableEnv = process.env as Record<string, string | undefined>;

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
	const saved = new Map(MANAGED.map((name) => [name, mutableEnv[name]] as const));
	for (const name of MANAGED) delete mutableEnv[name];
	for (const [name, value] of Object.entries(overrides)) {
		if (value !== undefined) mutableEnv[name] = value;
	}
	try {
		return run();
	} finally {
		for (const [name, value] of saved) {
			if (value === undefined) delete mutableEnv[name];
			else mutableEnv[name] = value;
		}
	}
}

const VALID = {
	AAE_AGENT_ENABLED: "true",
	AAE_API_BASE_URL: "https://aae.example.com",
	AAE_INTERNAL_AUTH_TOKEN: "internal-token-value",
	AAE_ALLOWED_USER_ID: "user_owner_123",
};

test("stays disabled unless explicitly enabled", () => {
	withEnv({ ...VALID, AAE_AGENT_ENABLED: undefined }, () => {
		assert.equal(isAaeEnabled(), false);
		assert.equal(isAaeConfigured(), false);
		assert.throws(() => getAaeConfig(), AaeConfigError);
	});
	for (const value of ["false", "TRUE ", "1", "yes"]) {
		withEnv({ ...VALID, AAE_AGENT_ENABLED: value }, () => {
			assert.equal(isAaeEnabled(), value.trim().toLowerCase() === "true");
		});
	}
});

test("fails closed without URL, token or single allowed user", () => {
	for (const missing of ["AAE_API_BASE_URL", "AAE_INTERNAL_AUTH_TOKEN", "AAE_ALLOWED_USER_ID"] as const) {
		withEnv({ ...VALID, [missing]: undefined }, () => {
			assert.equal(isAaeConfigured(), false);
			assert.throws(() => getAaeConfig(), AaeConfigError);
		});
	}
});

test("allows only the configured AIRA user", () => {
	withEnv({ ...VALID }, () => {
		assert.equal(isAaeUserAllowed("user_owner_123"), true);
		assert.equal(isAaeUserAllowed("another-user"), false);
	});
});

test("requires HTTPS in production", () => {
	withEnv({ ...VALID, AAE_API_BASE_URL: "http://aae.internal", NODE_ENV: "production" }, () => {
		assert.throws(() => getAaeConfig(), AaeConfigError);
	});
	withEnv({ ...VALID, AAE_API_BASE_URL: "http://127.0.0.1:8000", NODE_ENV: "development" }, () => {
		assert.equal(isAaeConfigured(), true);
	});
});

test("rejects unsafe base URLs", () => {
	for (const url of [
		"https://user:pass@aae.example.com",
		"https://aae.example.com?token=leak",
		"https://aae.example.com#fragment",
		"ftp://aae.example.com",
		"not-a-url",
	]) {
		withEnv({ ...VALID, AAE_API_BASE_URL: url }, () => {
			assert.throws(() => getAaeConfig(), AaeConfigError, `expected ${url} to be rejected`);
		});
	}
});

test("clamps request and health timeouts", () => {
	withEnv({ ...VALID, AAE_REQUEST_TIMEOUT_MS: "999999", AAE_HEALTH_TIMEOUT_MS: "1" }, () => {
		const config = getAaeConfig();
		assert.equal(config.requestTimeoutMs, 30_000);
		assert.equal(config.healthTimeoutMs, 500);
	});
	withEnv({ ...VALID }, () => {
		const config = getAaeConfig();
		assert.equal(config.requestTimeoutMs, 15_000);
		assert.equal(config.healthTimeoutMs, 2_500);
	});
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	DeerFlowConfigError,
	getDeerFlowConfig,
	isDeerFlowConfigured,
	isDeerFlowEnabled,
} from "../lib/deerflow/config";

const MANAGED = [
	"DEERFLOW_AGENT_ENABLED",
	"DEERFLOW_API_BASE_URL",
	"DEERFLOW_INTERNAL_AUTH_TOKEN",
	"DEERFLOW_MODEL_NAME",
	"DEERFLOW_THINKING_ENABLED",
	"DEERFLOW_PLAN_MODE",
	"DEERFLOW_REQUEST_TIMEOUT_MS",
	"DEERFLOW_HEALTH_TIMEOUT_MS",
	"NODE_ENV",
] as const;

// `process.env.NODE_ENV` is typed read-only, but these cases must exercise the
// production-only HTTPS rule, so the suite writes through a mutable view.
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
	DEERFLOW_AGENT_ENABLED: "true",
	DEERFLOW_API_BASE_URL: "https://deerflow.example.com",
	DEERFLOW_INTERNAL_AUTH_TOKEN: "internal-token-value",
};

test("stays disabled unless explicitly enabled", () => {
	withEnv({ ...VALID, DEERFLOW_AGENT_ENABLED: undefined }, () => {
		assert.equal(isDeerFlowEnabled(), false);
		assert.equal(isDeerFlowConfigured(), false);
		assert.throws(() => getDeerFlowConfig(), DeerFlowConfigError);
	});
	for (const value of ["false", "TRUE ", "1", "yes"]) {
		withEnv({ ...VALID, DEERFLOW_AGENT_ENABLED: value }, () => {
			// Only an exact case-insensitive "true" activates the runtime.
			assert.equal(isDeerFlowEnabled(), value.trim().toLowerCase() === "true");
		});
	}
});

test("fails closed when enabled without a base URL or token", () => {
	withEnv({ DEERFLOW_AGENT_ENABLED: "true" }, () => {
		assert.equal(isDeerFlowConfigured(), false);
		assert.throws(() => getDeerFlowConfig(), DeerFlowConfigError);
	});
	withEnv({ ...VALID, DEERFLOW_INTERNAL_AUTH_TOKEN: undefined }, () => {
		assert.equal(isDeerFlowConfigured(), false);
	});
	withEnv({ ...VALID, DEERFLOW_API_BASE_URL: undefined }, () => {
		assert.equal(isDeerFlowConfigured(), false);
	});
});

test("requires HTTPS in production", () => {
	withEnv(
		{ ...VALID, DEERFLOW_API_BASE_URL: "http://deerflow.internal", NODE_ENV: "production" },
		() => {
			assert.throws(() => getDeerFlowConfig(), DeerFlowConfigError);
		},
	);
	withEnv(
		{ ...VALID, DEERFLOW_API_BASE_URL: "http://127.0.0.1:8001", NODE_ENV: "development" },
		() => {
			assert.equal(isDeerFlowConfigured(), true);
		},
	);
});

test("rejects base URLs carrying credentials, queries or fragments", () => {
	for (const url of [
		"https://user:pass@deerflow.example.com",
		"https://deerflow.example.com?token=leak",
		"https://deerflow.example.com#fragment",
		"ftp://deerflow.example.com",
		"not-a-url",
	]) {
		withEnv({ ...VALID, DEERFLOW_API_BASE_URL: url }, () => {
			assert.throws(() => getDeerFlowConfig(), DeerFlowConfigError, `expected ${url} to be rejected`);
		});
	}
});

test("strips trailing slashes from the base URL path", () => {
	withEnv({ ...VALID, DEERFLOW_API_BASE_URL: "https://deerflow.example.com/gateway///" }, () => {
		assert.equal(getDeerFlowConfig().baseUrl.pathname, "/gateway");
	});
});

test("clamps timeouts into their supported bounds", () => {
	withEnv({ ...VALID, DEERFLOW_REQUEST_TIMEOUT_MS: "999999", DEERFLOW_HEALTH_TIMEOUT_MS: "1" }, () => {
		const config = getDeerFlowConfig();
		assert.equal(config.requestTimeoutMs, 30_000);
		assert.equal(config.healthTimeoutMs, 500);
	});
	withEnv({ ...VALID }, () => {
		const config = getDeerFlowConfig();
		assert.equal(config.requestTimeoutMs, 15_000);
		assert.equal(config.healthTimeoutMs, 2_500);
	});
	withEnv({ ...VALID, DEERFLOW_REQUEST_TIMEOUT_MS: "not-a-number" }, () => {
		assert.throws(() => getDeerFlowConfig(), DeerFlowConfigError);
	});
});

test("plan mode defaults on and thinking defaults off", () => {
	withEnv({ ...VALID }, () => {
		const config = getDeerFlowConfig();
		assert.equal(config.planMode, true);
		assert.equal(config.thinkingEnabled, false);
		assert.equal(config.modelName, undefined);
	});
	withEnv({ ...VALID, DEERFLOW_PLAN_MODE: "false", DEERFLOW_THINKING_ENABLED: "true" }, () => {
		const config = getDeerFlowConfig();
		assert.equal(config.planMode, false);
		assert.equal(config.thinkingEnabled, true);
	});
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	fetchOmniRouteModels,
	OmniRouteGatewayError,
} from "../src/services/omniroute/gateway";

const ENV_KEYS = [
	"NODE_ENV",
	"OMNIROUTE_ENABLED",
	"OMNIROUTE_BASE_URL",
	"OMNIROUTE_API_KEY",
	"OMNIROUTE_TIMEOUT_MS",
] as const;

async function withGatewayEnv(run: () => Promise<void>): Promise<void> {
	const previous = new Map<string, string | undefined>();
	for (const key of ENV_KEYS) previous.set(key, process.env[key]);
	process.env.NODE_ENV = "test";
	process.env.OMNIROUTE_ENABLED = "true";
	process.env.OMNIROUTE_BASE_URL = "http://127.0.0.1:20128";
	process.env.OMNIROUTE_API_KEY = "super-secret-test-key";
	process.env.OMNIROUTE_TIMEOUT_MS = "45000";
	try {
		await run();
	} finally {
		for (const key of ENV_KEYS) {
			const value = previous.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

async function withMockFetch(
	mock: typeof fetch,
	run: () => Promise<void>,
): Promise<void> {
	const original = globalThis.fetch;
	globalThis.fetch = mock;
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}

test("discovers, sanitizes, de-duplicates and sorts model registry entries", async () => {
	await withGatewayEnv(async () => {
		await withMockFetch(
			(async (_input, init) => {
				const authorization = new Headers(init?.headers).get("authorization");
				assert.equal(authorization, "Bearer super-secret-test-key");
				assert.equal(init?.redirect, "error");
				return new Response(
					JSON.stringify({
						data: [
							{ id: "provider/z-model", owned_by: " provider-z " },
							{ id: "auto/smart", owned_by: "omniroute" },
							{ id: "provider/z-model", owned_by: "duplicate" },
							{ id: "   " },
							{ id: 42 },
							{ id: "a".repeat(501) },
						],
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							"x-omniroute-version": "3.8.50",
							"x-omniroute-request-id": "req_test_123",
						},
					},
				);
			}) as typeof fetch,
			async () => {
				const snapshot = await fetchOmniRouteModels();
				assert.deepEqual(snapshot.models, [
					{ id: "auto/smart", ownedBy: "omniroute" },
					{ id: "provider/z-model", ownedBy: "provider-z" },
				]);
				assert.equal(snapshot.version, "3.8.50");
				assert.equal(snapshot.requestId, "req_test_123");
				assert.match(snapshot.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
			}
		);
	});
});

test("rejects malformed model-registry JSON with a stable public error", async () => {
	await withGatewayEnv(async () => {
		await withMockFetch(
			(async () => new Response("not-json", { status: 200 })) as typeof fetch,
			async () => {
				await assert.rejects(
					fetchOmniRouteModels(),
					(error: unknown) => error instanceof OmniRouteGatewayError && error.code === "OMNIROUTE_BAD_RESPONSE",
				);
			}
		);
	});
});

test("rejects oversized model registries before parsing", async () => {
	await withGatewayEnv(async () => {
		await withMockFetch(
			(async () => new Response("{}", { status: 200, headers: { "content-length": String(3 * 1024 * 1024) } })) as typeof fetch,
			async () => {
				await assert.rejects(
					fetchOmniRouteModels(),
					(error: unknown) => error instanceof OmniRouteGatewayError && error.code === "OMNIROUTE_RESPONSE_TOO_LARGE",
				);
			}
		);
	});
});

test("never reflects an upstream response body or API key in discovery failures", async () => {
	await withGatewayEnv(async () => {
		await withMockFetch(
			(async () => new Response("super-secret-test-key internal traceback", { status: 401 })) as typeof fetch,
			async () => {
				await assert.rejects(fetchOmniRouteModels(), (error: unknown) => {
					assert.ok(error instanceof OmniRouteGatewayError);
					assert.equal(error.code, "OMNIROUTE_UPSTREAM_ERROR");
					assert.equal(error.upstreamStatus, 401);
					assert.ok(!error.message.includes("super-secret-test-key"));
					assert.ok(!error.message.includes("traceback"));
					return true;
				});
			}
		);
	});
});

test("external cancellation is converted to a safe timeout/cancellation failure", async () => {
	await withGatewayEnv(async () => {
		await withMockFetch(
			(async (_input, init) => {
				if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
				throw new Error("expected an aborted signal");
			}) as typeof fetch,
			async () => {
				const controller = new AbortController();
				controller.abort();
				await assert.rejects(
					fetchOmniRouteModels(controller.signal),
					(error: unknown) => error instanceof OmniRouteGatewayError && error.code === "OMNIROUTE_TIMEOUT",
				);
			}
		);
	});
});

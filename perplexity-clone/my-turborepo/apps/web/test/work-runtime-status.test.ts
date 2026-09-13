import assert from "node:assert/strict";
import test, { mock } from "node:test";

let sessionUser: { id: string } | null = null;

mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (sessionUser ? { user: sessionUser } : null)),
	},
});

test("GET /api/agent-platform/runtime/status returns 401 when unauthenticated", async () => {
	sessionUser = null;
	const { GET } = await import("../app/api/agent-platform/runtime/status/route");
	const res = await GET();
	assert.equal(res.status, 401);
	const data = (await res.json()) as { error?: { code?: string } };
	assert.equal(data.error?.code, "UNAUTHENTICATED");
});

test("GET /api/agent-platform/runtime/status returns status structure when authenticated", async () => {
	sessionUser = { id: "usr_test_status_1" };
	const { GET } = await import("../app/api/agent-platform/runtime/status/route");
	const res = await GET();
	assert.equal(res.status, 200);
	const data = (await res.json()) as {
		enabled: boolean;
		configured: boolean;
		ready: boolean;
		provider: string | null;
		subsystems: {
			planner: { ready: boolean };
			agentExecution: { ready: boolean };
			browser: { ready: boolean; status: string };
			knowledge: { ready: boolean; status: string };
			route: { ready: boolean; status: string };
		};
		checkedAt: string;
	};
	assert.equal(typeof data.enabled, "boolean");
	assert.equal(typeof data.configured, "boolean");
	assert.equal(typeof data.ready, "boolean");
	assert.ok(data.subsystems.planner.ready);
	assert.ok(data.checkedAt);
});

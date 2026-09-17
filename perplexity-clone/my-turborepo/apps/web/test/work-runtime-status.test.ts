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

test("GET /api/agent-platform/runtime/status returns status structure when authenticated and enabled", async () => {
	sessionUser = { id: "usr_test_status_1" };
	const prevKey = process.env.OPENAI_API_KEY;
	const prevFlag = process.env.AIRA_WORK_RUNTIME_ENABLED;
	process.env.OPENAI_API_KEY = "sk-test-status-key";
	process.env.AIRA_WORK_RUNTIME_ENABLED = "true";
	try {
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
		assert.equal(data.enabled, true);
		assert.equal(typeof data.configured, "boolean");
		assert.equal(typeof data.ready, "boolean");
		assert.ok(data.subsystems.planner.ready);
		assert.ok(data.checkedAt);
	} finally {
		process.env.OPENAI_API_KEY = prevKey;
		if (prevFlag === undefined) {
			delete process.env.AIRA_WORK_RUNTIME_ENABLED;
		} else {
			process.env.AIRA_WORK_RUNTIME_ENABLED = prevFlag;
		}
	}
});

test("GET /api/agent-platform/runtime/status is disabled by default when flag is unset", async () => {
	sessionUser = { id: "usr_test_status_default_off" };
	const prevFlag = process.env.AIRA_WORK_RUNTIME_ENABLED;
	delete process.env.AIRA_WORK_RUNTIME_ENABLED;
	try {
		const { GET } = await import("../app/api/agent-platform/runtime/status/route");
		const res = await GET();
		assert.equal(res.status, 200);
		const data = (await res.json()) as { enabled: boolean; ready: boolean };
		assert.equal(data.enabled, false, "Work runtime must be disabled when AIRA_WORK_RUNTIME_ENABLED is unset");
		assert.equal(data.ready, false);
	} finally {
		if (prevFlag !== undefined) {
			process.env.AIRA_WORK_RUNTIME_ENABLED = prevFlag;
		}
	}
});

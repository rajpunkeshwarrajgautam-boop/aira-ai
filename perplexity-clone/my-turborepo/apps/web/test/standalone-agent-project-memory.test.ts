import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aira_test";
process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "true";

const USER_ALICE = "usr_alice_owner";
const USER_BOB = "usr_bob_attacker";
const PROJECT_ALICE = "7f8ba8ee-bf11-469c-9c53-edfb9dafa07f";
const PROJECT_BOB = "88888888-8888-4888-8888-888888888888";
const MEMORY_FIXTURE_KEY = "mission-goal";
const MEMORY_FIXTURE_CONTENT = "Durable execution engine release certification run";

interface CapturedCreateRunInput {
	userId: string;
	clientRequestId: string;
	objective: string;
	agentExecutionOptions?: {
		projectId?: string;
	};
}

let currentSessionUser: { id: string } | null = null;
let lastCreateRunInput: CapturedCreateRunInput | null = null;

// 1. Mock Auth
mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
	},
});

// 2. Mock Safety Gateway
mock.module("@services/safety/safety-gateway", {
	exports: {
		assertSafetyAllowed: mock.fn(async () => true),
		SafetyBlockedError: class extends Error {},
		SafetyGatewayError: class extends Error {},
	},
});

// 3. Mock Foundation Control Plane
mock.module("@/lib/foundation-control-plane", {
	exports: {
		admitFoundationRequest: mock.fn(async () => ({ allowed: true, leaseId: "lease_test_1" })),
		releaseFoundationLease: mock.fn(async () => {}),
	},
});

// 4. Mock Agent Runtime Selection & Registry
mock.module("@/lib/agent-runtime/registry", {
	exports: {
		getAgentRuntimeStates: mock.fn(async () => [{ id: "AIRA_AGENT", enabled: true, configured: true, ready: true }]),
		runtimeStatesById: mock.fn(() => ({})),
		selectAgentRuntime: mock.fn(async () => ({
			health: { id: "AIRA_AGENT", enabled: true, configured: true, ready: true, capabilities: { controlledTools: true } },
			createRun: mock.fn(async (input: CapturedCreateRunInput) => {
				lastCreateRunInput = input;
				return {
					run: {
						id: "run_test_created_123",
						userId: input.userId,
						provider: "AIRA_AGENT",
						clientRequestId: input.clientRequestId,
						objective: input.objective,
						status: "RUNNING",
					},
					agentRunsRemaining: 99,
				};
			}),
		})),
	},
});

// 5. Mock In-Memory Prisma on globalThis
const fixtureMemory = {
	id: "mem_fixture_1",
	userId: USER_ALICE,
	projectId: PROJECT_ALICE,
	memoryKey: MEMORY_FIXTURE_KEY,
	kind: "GOAL",
	content: MEMORY_FIXTURE_CONTENT,
	source: "test-fixture",
	importance: 5,
	confidence: 1,
	metadata: {},
	createdAt: new Date(),
	updatedAt: new Date(),
};

const mockPrisma = {
	$queryRaw: mock.fn(async (strings: unknown, ...params: unknown[]) => {
		const rawQuery = Array.isArray(strings) ? strings.join("") : String(strings);
		// Check for getProjectForUser: select * from "AgentProject" where "id" = ${projectId} and "userId" = ${userId}
		if (rawQuery.includes("AgentProject") && !rawQuery.includes("AgentProjectMemory")) {
			const projectId = params[0];
			const userId = params[1];
			if (userId === USER_ALICE && projectId === PROJECT_ALICE) {
				return [
					{
						id: PROJECT_ALICE,
						userId: USER_ALICE,
						name: "Alice Release Project",
						objective: "Certify release",
						status: "ACTIVE",
						config: {},
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];
			}
			if (userId === USER_BOB && projectId === PROJECT_BOB) {
				return [
					{
						id: PROJECT_BOB,
						userId: USER_BOB,
						name: "Bob Isolated Project",
						objective: "Attacker objective",
						status: "ACTIVE",
						config: {},
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];
			}
			return [];
		}

		// Check for listProjectMemory / retrieveProjectMemory:
		if (rawQuery.includes("AgentProjectMemory")) {
			const userId = params[0];
			const projectId = params[1];
			if (userId === USER_ALICE && projectId === PROJECT_ALICE) {
				return [fixtureMemory];
			}
			return [];
		}

		return [];
	}),
	$executeRaw: mock.fn(async () => 1),
	agentRunEvent: {
		upsert: mock.fn(async () => ({
			id: "ev_1",
			type: "SUBMITTED",
			status: "RUNNING",
			message: "accepted",
			metadata: null,
			createdAt: new Date(),
		})),
	},
	agentRun: {
		findUnique: mock.fn(async () => null),
	},
	user: {
		findUnique: mock.fn(async () => ({
			id: USER_ALICE,
			billingSubscription: { status: "ACTIVE" },
		})),
	},
	usageRecord: {
		findUnique: mock.fn(async () => null),
		upsert: mock.fn(async () => ({ agentRuns: 1 })),
	},
};

(globalThis as unknown as { prisma?: unknown }).prisma = mockPrisma;

// Dynamically import route and native adapters
const { POST } = await import("../app/api/agents/runs/route");
const { memoryToolAdapter } = await import("../lib/tool-gateway/native-adapters");
const { isNativeToolCallingEnabled } = await import("../lib/agent-runtime/native-tool-protocol");

interface MemoryToolExecutionResult {
	result: {
		memories: Array<{
			id: string;
			memoryKey: string;
			kind: string;
			content: string;
		}>;
	};
}

test("1. Existing standalone run requests without projectId remain compatible", async () => {
	currentSessionUser = { id: USER_ALICE };
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000001",
			objective: "Run baseline standalone mission without project binding",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 202);
	const captured1 = lastCreateRunInput as CapturedCreateRunInput | null;
	assert.ok(captured1, "createRun must have been called");
	assert.equal(captured1.agentExecutionOptions, undefined);
});

test("2. Authorized projectId is validated and passed to runtime execution options", async () => {
	currentSessionUser = { id: USER_ALICE };
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000002",
			projectId: PROJECT_ALICE,
			objective: "Retrieve the mission-goal from project memory",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 202);
	const captured2 = lastCreateRunInput as CapturedCreateRunInput | null;
	assert.ok(captured2, "createRun must have been called");
	assert.equal(captured2.agentExecutionOptions?.projectId, PROJECT_ALICE);
});

test("3. Another user's projectId is rejected with 404 (IDOR protection)", async () => {
	// User Bob attempts to access Alice's project
	currentSessionUser = { id: USER_BOB };
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000003",
			projectId: PROJECT_ALICE, // Alice's project
			objective: "Malicious attempt to read Alice's project memory",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 404);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "NOT_FOUND");
	assert.equal(lastCreateRunInput, null, "Runtime must NOT be invoked on unauthorized project");
});

test("4. Invalid non-UUID projectId fails schema validation safely with 400", async () => {
	currentSessionUser = { id: USER_ALICE };
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000004",
			projectId: "not-a-valid-uuid",
			objective: "Test invalid uuid",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 400);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "VALIDATION_ERROR");
	assert.equal(lastCreateRunInput, null);
});

test("5. Non-existent projectId fails closed with 404", async () => {
	currentSessionUser = { id: USER_ALICE };
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000005",
			projectId: "99999999-9999-4999-9999-999999999999",
			objective: "Test non existent project",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 404);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "NOT_FOUND");
	assert.equal(lastCreateRunInput, null);
});

test("6. memory.search retrieves seeded fixture when executed with authorized projectId", async () => {
	const context = {
		userId: USER_ALICE,
		projectId: PROJECT_ALICE,
		runId: "run_test_123",
		source: "AGENT" as const,
	};

	const searchResult = (await memoryToolAdapter.execute(context, "search", {
		query: "mission-goal",
	})) as MemoryToolExecutionResult;

	assert.ok(searchResult.result.memories.length > 0);
	assert.equal(searchResult.result.memories[0]?.memoryKey, MEMORY_FIXTURE_KEY);
	assert.equal(searchResult.result.memories[0]?.content, MEMORY_FIXTURE_CONTENT);
});

test("7. memory.search returns empty and isolates memories across different users and projects", async () => {
	// Bob searching with his own project cannot see Alice's fixture
	const contextBob = {
		userId: USER_BOB,
		projectId: PROJECT_BOB,
		runId: "run_test_456",
		source: "AGENT" as const,
	};

	const searchResult = (await memoryToolAdapter.execute(contextBob, "search", {
		query: "mission-goal",
	})) as MemoryToolExecutionResult;

	assert.equal(searchResult.result.memories.length, 0, "Bob must not receive Alice's memories");
});

test("8. Unauthenticated requests to POST /api/agents/runs are rejected with 401", async () => {
	currentSessionUser = null; // No active session
	lastCreateRunInput = null;

	const req = new Request("https://aira.local/api/agents/runs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientRequestId: "a0000000-0000-4000-8000-000000000008",
			projectId: PROJECT_ALICE,
			objective: "Unauthenticated call",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 401);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "UNAUTHENTICATED");
	assert.equal(lastCreateRunInput, null);
});

test("9. Native tool calling feature flag toggles correctly and preserves OFF safety", () => {
	const prev = process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED;
	try {
		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "false";
		assert.equal(isNativeToolCallingEnabled(), false);

		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "true";
		assert.equal(isNativeToolCallingEnabled(), true);
	} finally {
		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = prev;
	}
});

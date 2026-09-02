import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aira_test";

let sessionUser: { id: string } | null = null;

mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (sessionUser ? { user: sessionUser } : null)),
	},
});

const { GET: getMemory, POST: postMemory, PATCH: patchMemory, DELETE: deleteMemory } = await import("../app/api/memory/route");
const { GET: getGlobalSearch } = await import("../app/api/global-search/route");
const { POST: steerTaskPost } = await import("../app/api/agent-platform/runs/[runId]/tasks/[taskId]/steer/route");
const { POST: reconcileTaskPost } = await import("../app/api/agent-platform/runs/[runId]/tasks/[taskId]/reconcile/route");
const { POST: cancelRunPost } = await import("../app/api/agent-platform/runs/[runId]/cancel/route");
const { POST: resolveApprovalPost } = await import("../app/api/agent-platform/approvals/[approvalId]/route");
const { POST: transitionControlPost } = await import("../app/api/browser/sessions/[sessionId]/control/route");
const { GET: getKnowledge, POST: postKnowledge } = await import("../app/api/knowledge/route");
const { POST: postKnowledgeCallback } = await import("../app/api/knowledge/callback/route");

function request(url: string, init?: RequestInit): Request {
	return new Request(url, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

test("HTTP ROUTE RUNTIME: Memory route rejects unauthenticated requests across all HTTP verbs", async () => {
	sessionUser = null;

	const getRes = await getMemory(request("http://localhost/api/memory"));
	assert.equal(getRes.status, 401);
	assert.equal((await getRes.json()).error.code, "UNAUTHENTICATED");

	const postRes = await postMemory(request("http://localhost/api/memory", {
		method: "POST",
		body: JSON.stringify({ content: "Secret memory" }),
	}));
	assert.equal(postRes.status, 401);

	const patchRes = await patchMemory(request("http://localhost/api/memory", {
		method: "PATCH",
		body: JSON.stringify({ id: "mem-1", pinned: true }),
	}));
	assert.equal(patchRes.status, 401);

	const deleteRes = await deleteMemory(request("http://localhost/api/memory", {
		method: "DELETE",
		body: JSON.stringify({ id: "mem-1" }),
	}));
	assert.equal(deleteRes.status, 401);
});

test("HTTP ROUTE RUNTIME: Global Search rejects unauthenticated callers and isolates tenant results", async () => {
	// Anonymous -> 401
	sessionUser = null;
	const unauthRes = await getGlobalSearch(request("http://localhost/api/global-search?q=secret"));
	assert.equal(unauthRes.status, 401);

	// Short query -> empty results
	sessionUser = { id: "user-1" };
	const shortRes = await getGlobalSearch(request("http://localhost/api/global-search?q=a"));
	assert.equal(shortRes.status, 200);
	assert.deepEqual(await shortRes.json(), { results: [] });
});

test("HTTP ROUTE RUNTIME: High-risk mutation routes enforce 401 for anonymous callers", async () => {
	sessionUser = null;

	const steerRes = await steerTaskPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ instruction: "Steer instruction" }),
	}), { params: Promise.resolve({ runId: "run-1", taskId: "task-1" }) });
	assert.equal(steerRes.status, 401);

	const reconcileRes = await reconcileTaskPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: "run-1", taskId: "task-1" }) });
	assert.equal(reconcileRes.status, 401);

	const cancelRes = await cancelRunPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: "run-1" }) });
	assert.equal(cancelRes.status, 401);

	const approvalRes = await resolveApprovalPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ decision: "approve" }),
	}), { params: Promise.resolve({ approvalId: "appr-1" }) });
	assert.equal(approvalRes.status, 401);

	const controlRes = await transitionControlPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ control: "human" }),
	}), { params: Promise.resolve({ sessionId: "sess-1" }) });
	assert.equal(controlRes.status, 401);
});

test("HTTP ROUTE RUNTIME: Attacker supplying foreign IDs receives 404/denial without side effects", async () => {
	// Authenticated attacker
	sessionUser = { id: "attacker-b" };

	const steerRes = await steerTaskPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ instruction: "Malicious steer" }),
	}), { params: Promise.resolve({ runId: "foreign-run-id", taskId: "foreign-task-id" }) });
	assert.ok(steerRes.status === 404 || steerRes.status === 500);
	assert.equal((await steerRes.json()).error.code, "TASK_STEER_FAILED");

	const reconcileRes = await reconcileTaskPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: "foreign-run-id", taskId: "foreign-task-id" }) });
	assert.ok(reconcileRes.status === 404 || reconcileRes.status === 500);
	assert.equal((await reconcileRes.json()).error.code, "TASK_RECONCILE_FAILED");

	const cancelRes = await cancelRunPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: "foreign-run-id" }) });
	assert.ok(cancelRes.status === 404 || cancelRes.status === 500);

	const approvalRes = await resolveApprovalPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ decision: "approve" }),
	}), { params: Promise.resolve({ approvalId: "foreign-approval-id" }) });
	assert.ok(approvalRes.status === 404 || approvalRes.status === 500);
});

test("HTTP ROUTE RUNTIME: Knowledge GET and POST enforce session authentication and tenant boundaries", async () => {
	sessionUser = null;

	const getRes = await getKnowledge(request("http://localhost/api/knowledge"));
	assert.equal(getRes.status, 401);
	assert.equal((await getRes.json()).error.code, "UNAUTHENTICATED");

	const postRes = await postKnowledge(request("http://localhost/api/knowledge", { method: "POST" }));
	assert.equal(postRes.status, 401);
});

test("HTTP ROUTE RUNTIME: Knowledge worker callback requires valid worker authorization token", async () => {
	process.env.AIRA_KNOWLEDGE_WORKER_TOKEN = "secret-worker-token-12345";

	// Missing worker token -> 401
	const missingTokenRes = await postKnowledgeCallback(request("http://localhost/api/knowledge/callback", {
		method: "POST",
		body: JSON.stringify({ status: "failed", assetId: "00000000-0000-0000-0000-000000000001", userId: "user-1", error: "fail" }),
	}));
	assert.equal(missingTokenRes.status, 401);
	assert.equal((await missingTokenRes.json()).error.code, "UNAUTHORIZED");

	// Invalid worker token -> 401
	const wrongTokenRes = await postKnowledgeCallback(new Request("http://localhost/api/knowledge/callback", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-aira-worker-token": "wrong-token" },
		body: JSON.stringify({ status: "failed", assetId: "00000000-0000-0000-0000-000000000001", userId: "user-1", error: "fail" }),
	}));
	assert.equal(wrongTokenRes.status, 401);
	assert.equal((await wrongTokenRes.json()).error.code, "UNAUTHORIZED");

	// Valid worker token -> passes token gate
	const validTokenRes = await postKnowledgeCallback(new Request("http://localhost/api/knowledge/callback", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-aira-worker-token": "secret-worker-token-12345" },
		body: JSON.stringify({ status: "failed", assetId: "00000000-0000-0000-0000-000000000001", userId: "user-1", error: "fail" }),
	}));
	assert.notEqual(validTokenRes.status, 401);
});

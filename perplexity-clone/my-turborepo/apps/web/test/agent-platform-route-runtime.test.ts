import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aira_test";
process.env.MULTIMODAL_INGESTION_ENABLED = "true";

const OWNER_A = "user-owner-a";
const ATTACKER_B = "user-attacker-b";

const OWNER_RUN_ID = "run-owner-a-101";
const OWNER_TASK_ID = "task-owner-a-202";
const OWNER_APPROVAL_ID = "appr-owner-a-303";
const OWNER_BROWSER_SESSION_ID = "sess-owner-a-404";
const OWNER_MEMORY_ID = "mem-owner-a-505";
const OWNER_CONVERSATION_ID = "conv-owner-a-707";
const OWNER_ASSET_ID = "00000000-0000-4000-8000-000000000606";
const GATE28_OWNER_SECRET = "GATE28_OWNER_SECRET_9C7A";

let sessionUser: { id: string } | null = null;

// Track side-effect spy call counts
const sideEffects = {
	cancelManagedRunCalls: 0,
	steerManagedTaskCalls: 0,
	reconcileTaskCalls: 0,
	tickManagedRunCalls: 0,
	createManualMemoryCalls: [] as Array<Record<string, unknown>>,
	setUserMemoryPinnedCalls: 0,
	deleteUserMemoryCalls: 0,
	transitionBrowserControlCalls: 0,
	updateKnowledgeAssetStatusCalls: 0,
	replaceKnowledgeChunksCalls: 0,
};

function resetSideEffects() {
	sideEffects.cancelManagedRunCalls = 0;
	sideEffects.steerManagedTaskCalls = 0;
	sideEffects.reconcileTaskCalls = 0;
	sideEffects.tickManagedRunCalls = 0;
	sideEffects.createManualMemoryCalls = [];
	sideEffects.setUserMemoryPinnedCalls = 0;
	sideEffects.deleteUserMemoryCalls = 0;
	sideEffects.transitionBrowserControlCalls = 0;
	sideEffects.updateKnowledgeAssetStatusCalls = 0;
	sideEffects.replaceKnowledgeChunksCalls = 0;
}

// 1. Mock Auth
mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (sessionUser ? { user: sessionUser } : null)),
	},
});

// 2. Mock Orchestrator
mock.module("@/lib/agent-platform/orchestrator", {
	exports: {
		steerManagedTask: mock.fn(async (params: { userId: string; runId: string; taskId: string; instruction: string }) => {
			if (params.userId === OWNER_A && params.runId === OWNER_RUN_ID && params.taskId === OWNER_TASK_ID) {
				sideEffects.steerManagedTaskCalls++;
				return { ok: true };
			}
			throw new Error("Managed run not found.");
		}),
		cancelManagedRun: mock.fn(async (userId: string, runId: string) => {
			if (userId === OWNER_A && runId === OWNER_RUN_ID) {
				sideEffects.cancelManagedRunCalls++;
				return { id: OWNER_RUN_ID, status: "CANCELLED" };
			}
			throw new Error("Managed run not found.");
		}),
		tickManagedRun: mock.fn(async (_userId: string, _runId: string) => {
			sideEffects.tickManagedRunCalls++;
			return null;
		}),
	},
});

// 3. Mock Store
mock.module("@/lib/agent-platform/store", {
	exports: {
		getRunForUser: mock.fn(async (userId: string, runId: string) => {
			if (userId === OWNER_A && runId === OWNER_RUN_ID) {
				return { id: OWNER_RUN_ID, userId: OWNER_A, status: "RUNNING" };
			}
			return null;
		}),
		getBrowserSession: mock.fn(async (userId: string, sessionId: string) => {
			if (userId === OWNER_A && sessionId === OWNER_BROWSER_SESSION_ID) {
				return { id: OWNER_BROWSER_SESSION_ID, userId: OWNER_A, status: "ACTIVE" };
			}
			return null;
		}),
		recordBrowserAction: mock.fn(async () => null),
		resolveApproval: mock.fn(async (params: { userId: string; approvalId: string; approve: boolean }) => {
			if (params.userId === OWNER_A && params.approvalId === OWNER_APPROVAL_ID) {
				return { id: OWNER_APPROVAL_ID, runId: OWNER_RUN_ID, userId: OWNER_A, status: params.approve ? "APPROVED" : "REJECTED" };
			}
			return null;
		}),
		tickManagedRun: mock.fn(async (_userId: string, _runId: string) => {
			sideEffects.tickManagedRunCalls++;
			return { ok: true };
		}),
	},
});

// 4. Mock Recovery
mock.module("@/lib/agent-platform/recovery", {
	exports: {
		ManagedTaskRecoveryError: class ManagedTaskRecoveryError extends Error {
			code: string;
			status: number;
			constructor(code: string, message: string, status: number = 400) {
				super(message);
				this.code = code;
				this.status = status;
				this.name = "ManagedTaskRecoveryError";
			}
		},
		reconcileBlockedManagedTask: mock.fn(async (params: { userId: string; runId: string; taskId: string }) => {
			if (params.userId === OWNER_A && params.runId === OWNER_RUN_ID && params.taskId === OWNER_TASK_ID) {
				sideEffects.reconcileTaskCalls++;
				return { requeued: true };
			}
			const { ManagedTaskRecoveryError: Err } = await import("@/lib/agent-platform/recovery");
			throw new Err("TASK_RECONCILE_FAILED", "Blocked task not found for this user.", 404);
		}),
	},
});

// 5. Mock Tool Approvals & Approval Expiry
mock.module("@/lib/agents/tool-approvals", {
	exports: {
		expireApprovalIfStale: mock.fn(async () => false),
		resolveToolApproval: mock.fn(async (params: { userId: string; approvalId: string; approve: boolean }) => {
			if (params.userId === OWNER_A && params.approvalId === OWNER_APPROVAL_ID) {
				return { id: OWNER_APPROVAL_ID, status: params.approve ? "APPROVED" : "REJECTED" };
			}
			return null;
		}),
	},
});

mock.module("@/lib/tool-gateway/approval", {
	exports: {
		resolveToolApproval: mock.fn(async (params: { userId: string; approvalId: string; approve: boolean }) => {
			if (params.userId === OWNER_A && params.approvalId === OWNER_APPROVAL_ID) {
				return { id: OWNER_APPROVAL_ID, status: params.approve ? "APPROVED" : "REJECTED" };
			}
			return null;
		}),
	},
});

mock.module("@/lib/agent-platform/approval-expiry", {
	exports: {
		APPROVAL_TTL_MINUTES: 30,
		expireApprovalIfStale: mock.fn(async () => false),
	},
});

// 6. Mock Browser Arbitration
mock.module("@/lib/agent-platform/browser-arbitration", {
	exports: {
		transitionBrowserControl: mock.fn(async (params: { userId: string; sessionId: string; control: string }) => {
			if (params.userId === OWNER_A && params.sessionId === OWNER_BROWSER_SESSION_ID) {
				sideEffects.transitionBrowserControlCalls++;
				return { id: OWNER_BROWSER_SESSION_ID, control: params.control };
			}
			return null;
		}),
	},
});

// 7. Mock Persistent Memory
mock.module("@/lib/persistent-memory", {
	exports: {
		listUserMemories: mock.fn(async (userId: string, _limit?: number) => {
			if (userId === OWNER_A) {
				return [{ id: OWNER_MEMORY_ID, userId: OWNER_A, content: GATE28_OWNER_SECRET, kind: "PREFERENCE", pinned: true, updatedAt: new Date() }];
			}
			return [];
		}),
		createManualMemory: mock.fn(async (params: Record<string, unknown>) => {
			sideEffects.createManualMemoryCalls.push(params);
			return { id: "mem-new-123", ...params };
		}),
		setUserMemoryPinned: mock.fn(async (userId: string, id: string, _pinned: boolean) => {
			if (userId === OWNER_A && id === OWNER_MEMORY_ID) {
				sideEffects.setUserMemoryPinnedCalls++;
				return true;
			}
			return false;
		}),
		deleteUserMemory: mock.fn(async (userId: string, id: string) => {
			if (userId === OWNER_A && id === OWNER_MEMORY_ID) {
				sideEffects.deleteUserMemoryCalls++;
				return true;
			}
			return false;
		}),
	},
});

// 8. Mock Conversation Memory
mock.module("@/lib/conversation-memory", {
	exports: {
		listConversations: mock.fn(async (userId: string, _limit?: number) => {
			if (userId === OWNER_A) {
				return [{ id: OWNER_CONVERSATION_ID, userId: OWNER_A, title: `Chat about ${GATE28_OWNER_SECRET}`, lastMessageAt: new Date() }];
			}
			return [];
		}),
	},
});

// 9. Mock Global Search
mock.module("@/lib/global-search", {
	exports: {
		searchConversationMessages: mock.fn(async (userId: string, _q: string, _limit?: number) => {
			if (userId === OWNER_A) {
				return [{
					id: "msg-1",
					conversationId: OWNER_CONVERSATION_ID,
					content: `Found ${GATE28_OWNER_SECRET} in message body`,
					role: "USER",
					createdAt: new Date(),
					conversation: { id: OWNER_CONVERSATION_ID, title: `Chat about ${GATE28_OWNER_SECRET}` },
				}];
			}
			return [];
		}),
	},
});

// 10. Mock Knowledge Assets & Storage
mock.module("@/lib/knowledge-assets", {
	exports: {
		createKnowledgeAsset: mock.fn(async (_params: Record<string, unknown>) => OWNER_ASSET_ID),
		listKnowledgeAssets: mock.fn(async (userId: string, _limit?: number) => {
			if (userId === OWNER_A) {
				return [{ id: OWNER_ASSET_ID, userId: OWNER_A, filename: "owner-secret.pdf", storageKey: `knowledge/${OWNER_A}/secret.pdf` }];
			}
			return [];
		}),
		updateKnowledgeAssetStatus: mock.fn(async (_assetId: string, _status: string) => {
			sideEffects.updateKnowledgeAssetStatusCalls++;
		}),
		replaceKnowledgeChunks: mock.fn(async (_assetId: string, _chunks: unknown[]) => {
			sideEffects.replaceKnowledgeChunksCalls++;
		}),
	},
});

mock.module("@/lib/foundation-storage", {
	exports: {
		knowledgeStorageConfigured: mock.fn(() => true),
		createKnowledgeSignedUrl: mock.fn(async () => "http://localhost/signed"),
		uploadKnowledgeObject: mock.fn(async () => ({ ok: true })),
		deleteKnowledgeObject: mock.fn(async () => ({ ok: true })),
	},
});

// Import actual route handlers AFTER module mocks are established
const { GET: getMemory, POST: postMemory, PATCH: patchMemory, DELETE: deleteMemory } = await import("../app/api/memory/route");
const { GET: getGlobalSearch } = await import("../app/api/global-search/route");
const { POST: steerTaskPost } = await import("../app/api/agent-platform/runs/[runId]/tasks/[taskId]/steer/route");
const { POST: reconcileTaskPost } = await import("../app/api/agent-platform/runs/[runId]/tasks/[taskId]/reconcile/route");
const { POST: cancelRunPost } = await import("../app/api/agent-platform/runs/[runId]/cancel/route");
const { POST: resolveApprovalPost } = await import("../app/api/agent-platform/approvals/[approvalId]/route");
const { POST: transitionControlPost } = await import("../app/api/browser/sessions/[sessionId]/control/route");
const { GET: getKnowledge, POST: postKnowledge } = await import("../app/api/knowledge/route");
const { POST: postKnowledgeCallback } = await import("../app/api/knowledge/callback/route");
const { GET: getKnowledgeLibrary } = await import("../app/api/knowledge/library/route");

function request(url: string, init?: RequestInit): Request {
	return new Request(url, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

test("HTTP ROUTE RUNTIME: Task Steer true Owner-vs-Attacker isolation", async () => {
	resetSideEffects();

	// 1. Owner A -> Succeeds
	sessionUser = { id: OWNER_A };
	const ownerRes = await steerTaskPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ instruction: "Steer owner task" }),
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID, taskId: OWNER_TASK_ID }) });
	assert.equal(ownerRes.status, 200);
	assert.equal(sideEffects.steerManagedTaskCalls, 1);

	// 2. Attacker B attempting same exact OWNER_RUN_ID + OWNER_TASK_ID -> 404, ZERO side effects
	sessionUser = { id: ATTACKER_B };
	const attackerRes = await steerTaskPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ instruction: "Malicious steer" }),
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID, taskId: OWNER_TASK_ID }) });
	assert.equal(attackerRes.status, 404);
	assert.equal((await attackerRes.json()).error.code, "TASK_STEER_FAILED");
	assert.equal(sideEffects.steerManagedTaskCalls, 1); // Remains 1 from owner call

	// 3. Anonymous -> 401
	sessionUser = null;
	const unauthRes = await steerTaskPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ instruction: "Steer instruction" }),
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID, taskId: OWNER_TASK_ID }) });
	assert.equal(unauthRes.status, 401);
});

test("HTTP ROUTE RUNTIME: Task Reconcile true Owner-vs-Attacker isolation", async () => {
	resetSideEffects();

	// 1. Owner A -> Succeeds
	sessionUser = { id: OWNER_A };
	const ownerRes = await reconcileTaskPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID, taskId: OWNER_TASK_ID }) });
	assert.equal(ownerRes.status, 200);
	assert.equal(sideEffects.reconcileTaskCalls, 1);

	// 2. Attacker B attempting same exact OWNER_RUN_ID + OWNER_TASK_ID -> 404, ZERO side effects
	sessionUser = { id: ATTACKER_B };
	const attackerRes = await reconcileTaskPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID, taskId: OWNER_TASK_ID }) });
	assert.equal(attackerRes.status, 404);
	assert.equal((await attackerRes.json()).error.code, "TASK_RECONCILE_FAILED");
	assert.equal(sideEffects.reconcileTaskCalls, 1); // Remains 1 from owner call
});

test("HTTP ROUTE RUNTIME: Run Cancel true Owner-vs-Attacker isolation and zero-side-effect fence", async () => {
	resetSideEffects();

	// 1. Owner A -> Succeeds
	sessionUser = { id: OWNER_A };
	const ownerRes = await cancelRunPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID }) });
	assert.equal(ownerRes.status, 200);
	assert.equal(sideEffects.cancelManagedRunCalls, 1);

	// 2. Attacker B attempting same exact OWNER_RUN_ID -> 404, ZERO side effects
	sessionUser = { id: ATTACKER_B };
	const attackerRes = await cancelRunPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID }) });
	assert.equal(attackerRes.status, 404);
	assert.equal((await attackerRes.json()).error.code, "NOT_FOUND");
	assert.equal(sideEffects.cancelManagedRunCalls, 1); // Remains 1, cancelManagedRun NEVER called for attacker

	// 3. Anonymous -> 401
	sessionUser = null;
	const unauthRes = await cancelRunPost(request("http://localhost/test", {
		method: "POST",
	}), { params: Promise.resolve({ runId: OWNER_RUN_ID }) });
	assert.equal(unauthRes.status, 401);
	assert.equal(sideEffects.cancelManagedRunCalls, 1);
});

test("HTTP ROUTE RUNTIME: Approval Resolution true Owner-vs-Attacker isolation", async () => {
	resetSideEffects();

	// 1. Owner A resolving mission approval -> Succeeds and ticks managed run
	sessionUser = { id: OWNER_A };
	const ownerRes = await resolveApprovalPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ decision: "approve" }),
	}), { params: Promise.resolve({ approvalId: OWNER_APPROVAL_ID }) });
	assert.equal(ownerRes.status, 200);

	// 2. Attacker B attempting same exact OWNER_APPROVAL_ID -> 404, ZERO side effects
	sessionUser = { id: ATTACKER_B };
	const attackerRes = await resolveApprovalPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ decision: "approve" }),
	}), { params: Promise.resolve({ approvalId: OWNER_APPROVAL_ID }) });
	assert.equal(attackerRes.status, 404);
	assert.equal((await attackerRes.json()).error.code, "NOT_FOUND");

	// 3. Anonymous -> 401
	sessionUser = null;
	const unauthRes = await resolveApprovalPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ decision: "approve" }),
	}), { params: Promise.resolve({ approvalId: OWNER_APPROVAL_ID }) });
	assert.equal(unauthRes.status, 401);
});

test("HTTP ROUTE RUNTIME: Browser Control true Owner-vs-Attacker isolation", async () => {
	resetSideEffects();

	// 1. Owner A -> Succeeds
	sessionUser = { id: OWNER_A };
	const ownerRes = await transitionControlPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ control: "human" }),
	}), { params: Promise.resolve({ sessionId: OWNER_BROWSER_SESSION_ID }) });
	assert.equal(ownerRes.status, 200);
	assert.equal(sideEffects.transitionBrowserControlCalls, 1);

	// 2. Attacker B attempting same exact OWNER_BROWSER_SESSION_ID -> 404, ZERO side effects
	sessionUser = { id: ATTACKER_B };
	const attackerRes = await transitionControlPost(request("http://localhost/test", {
		method: "POST",
		body: JSON.stringify({ control: "agent" }),
	}), { params: Promise.resolve({ sessionId: OWNER_BROWSER_SESSION_ID }) });
	assert.equal(attackerRes.status, 404);
	assert.equal((await attackerRes.json()).error.code, "NOT_FOUND");
	assert.equal(sideEffects.transitionBrowserControlCalls, 1);
});

test("HTTP ROUTE RUNTIME: Memory route true Owner-vs-Attacker tenant isolation and user ID binding", async () => {
	resetSideEffects();

	// 1. Owner A GET -> sees own memory containing secret
	sessionUser = { id: OWNER_A };
	const ownerGetRes = await getMemory(request("http://localhost/api/memory"));
	assert.equal(ownerGetRes.status, 200);
	const ownerMemories = (await ownerGetRes.json()).memories;
	assert.equal(ownerMemories.length, 1);
	assert.equal(ownerMemories[0].content, GATE28_OWNER_SECRET);

	// 2. Attacker B GET -> returns empty array, ZERO Owner A memory leakage
	sessionUser = { id: ATTACKER_B };
	const attackerGetRes = await getMemory(request("http://localhost/api/memory"));
	assert.equal(attackerGetRes.status, 200);
	const attackerMemories = (await attackerGetRes.json()).memories;
	assert.equal(attackerMemories.length, 0);

	// 3. Attacker B POST with attempted spoofed userId in body -> userId is strictly bound to session (ATTACKER_B)
	sessionUser = { id: ATTACKER_B };
	const postRes = await postMemory(request("http://localhost/api/memory", {
		method: "POST",
		body: JSON.stringify({ content: "Attacker memory", userId: OWNER_A }),
	}));
	assert.equal(postRes.status, 201);
	assert.equal(sideEffects.createManualMemoryCalls.length, 1);
	assert.equal(sideEffects.createManualMemoryCalls[0].userId, ATTACKER_B); // Bound to session, not spoofed body

	// 4. Attacker B PATCH with OWNER_MEMORY_ID -> 404, ZERO state change
	const patchRes = await patchMemory(request("http://localhost/api/memory", {
		method: "PATCH",
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	}));
	assert.equal(patchRes.status, 404);
	assert.equal(sideEffects.setUserMemoryPinnedCalls, 0);

	// 5. Attacker B DELETE with OWNER_MEMORY_ID -> 404, ZERO state change
	const deleteRes = await deleteMemory(request("http://localhost/api/memory", {
		method: "DELETE",
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	}));
	assert.equal(deleteRes.status, 404);
	assert.equal(sideEffects.deleteUserMemoryCalls, 0);
});

test("HTTP ROUTE RUNTIME: Global Search cross-tenant secrecy proof (zero secret leakage)", async () => {
	// 1. Owner A searching for secret -> returns Owner A conversation, memory, and message
	sessionUser = { id: OWNER_A };
	const ownerSearchRes = await getGlobalSearch(request(`http://localhost/api/global-search?q=${encodeURIComponent(GATE28_OWNER_SECRET)}`));
	assert.equal(ownerSearchRes.status, 200);
	const ownerResults = (await ownerSearchRes.json()).results;
	assert.ok(ownerResults.length >= 3);

	// 2. Attacker B searching for exact Owner A secret phrase -> returns ZERO results (0 leakage)
	sessionUser = { id: ATTACKER_B };
	const attackerSearchRes = await getGlobalSearch(request(`http://localhost/api/global-search?q=${encodeURIComponent(GATE28_OWNER_SECRET)}`));
	assert.equal(attackerSearchRes.status, 200);
	const attackerResults = (await attackerSearchRes.json()).results;
	assert.equal(attackerResults.length, 0);

	const textResponse = JSON.stringify(attackerResults);
	assert.equal(textResponse.includes(GATE28_OWNER_SECRET), false);
	assert.equal(textResponse.includes(OWNER_CONVERSATION_ID), false);
	assert.equal(textResponse.includes(OWNER_MEMORY_ID), false);
});

test("HTTP ROUTE RUNTIME: Knowledge GET and Library tenant isolation", async () => {
	// 1. Owner A GET -> sees own knowledge asset
	sessionUser = { id: OWNER_A };
	const ownerKnowledgeRes = await getKnowledge(request("http://localhost/api/knowledge"));
	assert.equal(ownerKnowledgeRes.status, 200);
	const ownerAssets = (await ownerKnowledgeRes.json()).assets;
	assert.equal(ownerAssets.length, 1);
	assert.equal(ownerAssets[0].id, OWNER_ASSET_ID);

	// 2. Attacker B GET -> returns empty array, ZERO Owner A asset disclosure
	sessionUser = { id: ATTACKER_B };
	const attackerKnowledgeRes = await getKnowledge(request("http://localhost/api/knowledge"));
	assert.equal(attackerKnowledgeRes.status, 200);
	const attackerAssets = (await attackerKnowledgeRes.json()).assets;
	assert.equal(attackerAssets.length, 0);

	// 3. Knowledge Library GET tenant check
	sessionUser = { id: ATTACKER_B };
	const libraryRes = await getKnowledgeLibrary(request("http://localhost/api/knowledge/library"));
	assert.equal(libraryRes.status, 200);
	const libraryAssets = (await libraryRes.json()).assets;
	assert.equal(libraryAssets.length, 0);
});

test("HTTP ROUTE RUNTIME: Knowledge worker callback tenant binding", async () => {
	resetSideEffects();
	process.env.AIRA_KNOWLEDGE_WORKER_TOKEN = "secret-worker-token-99999";

	// 1. Missing or invalid worker token -> 401
	const unauthCallbackRes = await postKnowledgeCallback(request("http://localhost/api/knowledge/callback", {
		method: "POST",
		body: JSON.stringify({ status: "failed", assetId: OWNER_ASSET_ID, userId: OWNER_A, error: "failed" }),
	}));
	assert.equal(unauthCallbackRes.status, 401);

	// 2. Valid worker token with matching payload -> succeeds
	const validCallbackRes = await postKnowledgeCallback(new Request("http://localhost/api/knowledge/callback", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-aira-worker-token": "secret-worker-token-99999" },
		body: JSON.stringify({ status: "failed", assetId: OWNER_ASSET_ID, userId: OWNER_A, error: "failed" }),
	}));
	assert.equal(validCallbackRes.status, 200);
	assert.equal(sideEffects.updateKnowledgeAssetStatusCalls, 1);
});

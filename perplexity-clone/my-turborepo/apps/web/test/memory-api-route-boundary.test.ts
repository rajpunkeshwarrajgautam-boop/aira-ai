import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aira_test";

const USER_OWNER = "user-owner-alice";
const USER_ATTACKER = "user-attacker-eve";
const OWNER_MEMORY_ID = "mem-owner-101";

interface SessionUser {
	id: string;
}

let mockSessionUser: SessionUser | null = null;

interface CreateMemoryArgs {
	userId: string;
	content: string;
	kind?: string;
	pinned?: boolean;
}

interface MemoryPinArgs {
	userId: string;
	id: string;
	pinned: boolean;
}

interface MemoryDeleteArgs {
	userId: string;
	id: string;
}

interface MemoryListArgs {
	userId: string;
	limit: number;
}

const spyCalls = {
	createManualMemory: [] as CreateMemoryArgs[],
	setUserMemoryPinned: [] as MemoryPinArgs[],
	deleteUserMemory: [] as MemoryDeleteArgs[],
	listUserMemories: [] as MemoryListArgs[],
};

function resetSpies() {
	mockSessionUser = null;
	spyCalls.createManualMemory = [];
	spyCalls.setUserMemoryPinned = [];
	spyCalls.deleteUserMemory = [];
	spyCalls.listUserMemories = [];
}

// 1. Mock Auth
mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => {
			if (!mockSessionUser) return null;
			return { user: mockSessionUser };
		}),
	},
} as unknown as Record<string, unknown>);

// 2. Mock Persistent Memory High-Level Module for Route Dispatch Testing
// Note: This tests HTTP route handler mapping & parameter passing to the memory service layer.
mock.module("@/lib/persistent-memory", {
	exports: {
		listUserMemories: mock.fn(async (userId: string, limit: number) => {
			spyCalls.listUserMemories.push({ userId, limit });
			if (userId === USER_OWNER) {
				return [
					{
						id: OWNER_MEMORY_ID,
						memoryKey: "manual.test",
						kind: "PREFERENCE",
						content: "I prefer dark mode",
						keywords: ["prefer", "dark", "mode"],
						importance: 4,
						confidence: 1,
						pinned: true,
						lastRecalledAt: null,
						recallCount: 0,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];
			}
			return [];
		}),
		createManualMemory: mock.fn(async (args: CreateMemoryArgs) => {
			spyCalls.createManualMemory.push(args);
			if (args.content.includes("FORBIDDEN_MOCK_ERROR")) {
				throw new Error("Memory content rejected by downstream service.");
			}
			return {
				id: "mem-new-999",
				memoryKey: "manual.new",
				kind: args.kind ?? "OTHER",
				content: args.content,
				keywords: ["test"],
				importance: args.pinned ? 5 : 4,
				confidence: 1,
				pinned: args.pinned ?? true,
				lastRecalledAt: null,
				recallCount: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
		}),
		setUserMemoryPinned: mock.fn(async (userId: string, id: string, pinned: boolean) => {
			spyCalls.setUserMemoryPinned.push({ userId, id, pinned });
			if (userId === USER_OWNER && id === OWNER_MEMORY_ID) {
				return true;
			}
			return false;
		}),
		deleteUserMemory: mock.fn(async (userId: string, id: string) => {
			spyCalls.deleteUserMemory.push({ userId, id });
			if (userId === USER_OWNER && id === OWNER_MEMORY_ID) {
				return true;
			}
			return false;
		}),
	},
} as unknown as Record<string, unknown>);

// Dynamically import exported App Router handlers after setting up module mocks
const { GET, POST, PATCH, DELETE } = await import("../app/api/memory/route");

test("[Mocked Route Dispatch] Unauthenticated requests return 401 and execute 0 downstream handler calls", async () => {
	resetSpies();
	mockSessionUser = null;

	const reqGet = new Request("http://localhost:3000/api/memory");
	const resGet = await GET(reqGet);
	assert.equal(resGet.status, 401);

	const reqPost = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "I prefer dark mode" }),
	});
	const resPost = await POST(reqPost);
	assert.equal(resPost.status, 401);

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 401);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 401);

	assert.equal(spyCalls.listUserMemories.length, 0);
	assert.equal(spyCalls.createManualMemory.length, 0);
	assert.equal(spyCalls.setUserMemoryPinned.length, 0);
	assert.equal(spyCalls.deleteUserMemory.length, 0);
});

test("[Mocked Route Dispatch] POST ignores body userId/confirmed/memoryKey overrides and binds to session.user.id", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			content: "I live in Berlin",
			userId: USER_ATTACKER,
			confirmed: true,
			memoryKey: "manual.override",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	const data = (await res.json()) as { memory: { id: string; content: string; memoryKey: string } };
	
	// Verified: Production UserMemoryDto does not contain userId.
	// Ownership is asserted via the arguments passed to createManualMemory.
	assert.equal(data.memory.id, "mem-new-999");
	assert.equal(data.memory.content, "I live in Berlin");
	assert.equal("userId" in data.memory, false, "Response DTO must not contain userId field");

	assert.equal(spyCalls.createManualMemory.length, 1);
	assert.equal(spyCalls.createManualMemory[0]!.userId, USER_OWNER, "Downstream call must use session user ID");
	assert.equal(spyCalls.createManualMemory[0]!.content, "I live in Berlin");
});

test("[Mocked Route Dispatch] Malformed JSON or invalid payload fails with 400 validation error", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqBadJson = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{ invalid json ...",
	});
	const resBadJson = await POST(reqBadJson);
	assert.equal(resBadJson.status, 400);
	const badJsonData = (await resBadJson.json()) as { error: { code: string } };
	assert.equal(badJsonData.error.code, "INVALID_JSON");

	const reqShort = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "ab" }),
	});
	const resShort = await POST(reqShort);
	assert.equal(resShort.status, 400);
	const shortData = (await resShort.json()) as { error: { code: string } };
	assert.equal(shortData.error.code, "VALIDATION_ERROR");

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[Mocked Route Dispatch] Error-response mapping: thrown error in createManualMemory maps to 400 MEMORY_REJECTED", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "FORBIDDEN_MOCK_ERROR test content" }),
	});

	const res = await POST(req);
	assert.equal(res.status, 400);
	const data = (await res.json()) as { error: { code: string; message: string } };
	assert.equal(data.error.code, "MEMORY_REJECTED");
	assert.equal(data.error.message, "Memory content rejected by downstream service.");

	assert.equal(spyCalls.createManualMemory.length, 1);
});

test("[Mocked Route Dispatch] Cross-user PATCH/DELETE targeting another user's memory ID returns 404 NOT_FOUND", async () => {
	resetSpies();
	mockSessionUser = { id: USER_ATTACKER };

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 404);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 404);

	assert.equal(spyCalls.setUserMemoryPinned.length, 1);
	assert.equal(spyCalls.setUserMemoryPinned[0]!.userId, USER_ATTACKER);
	assert.equal(spyCalls.deleteUserMemory.length, 1);
	assert.equal(spyCalls.deleteUserMemory[0]!.userId, USER_ATTACKER);
});

test("[Mocked Route Dispatch] Valid owner GET, PATCH, and DELETE operations succeed", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqGet = new Request("http://localhost:3000/api/memory?limit=10");
	const resGet = await GET(reqGet);
	assert.equal(resGet.status, 200);
	const dataGet = (await resGet.json()) as { memories: Array<{ id: string; content: string }> };
	assert.equal(dataGet.memories.length, 1);
	assert.equal(dataGet.memories[0]!.id, OWNER_MEMORY_ID);

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 200);
	const dataPatch = (await resPatch.json()) as { ok: boolean };
	assert.equal(dataPatch.ok, true);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 200);
	const dataDelete = (await resDelete.json()) as { ok: boolean };
	assert.equal(dataDelete.ok, true);

	assert.equal(spyCalls.setUserMemoryPinned.length, 1);
	assert.equal(spyCalls.setUserMemoryPinned[0]!.userId, USER_OWNER);
	assert.equal(spyCalls.deleteUserMemory.length, 1);
	assert.equal(spyCalls.deleteUserMemory[0]!.userId, USER_OWNER);
});

// Section 5 Characterization Suite: Content-Type and Origin Header Behavior
test("[Header Characterization] Exact same-origin request with matching URL and Origin succeeds", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "http://localhost:3000",
		},
		body: JSON.stringify({ content: "Same-origin memory save" }),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	assert.equal(spyCalls.createManualMemory.length, 1);
});

test("[Header Characterization] Server accepts valid JSON sent with text/plain (no preflight content-type check)", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: {
			"content-type": "text/plain",
			origin: "https://attacker.com",
		},
		body: JSON.stringify({ content: "Memory sent via text/plain" }),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	assert.equal(spyCalls.createManualMemory.length, 1);
	assert.equal(spyCalls.createManualMemory[0]!.content, "Memory sent via text/plain");
});

test("[Header Characterization] Truly absent Content-Type header allows JSON body parsing", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		body: JSON.stringify({ content: "Memory with no content-type" }),
	});
	req.headers.delete("content-type");
	assert.equal(req.headers.has("content-type"), false, "Header must be verifiably absent");

	const res = await POST(req);
	assert.equal(res.status, 201);
	assert.equal(spyCalls.createManualMemory.length, 1);
});

test("[Header Characterization] Foreign, null, and missing Origin headers are accepted without server-side validation", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	// 1. Foreign Origin
	const reqForeignOrigin = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://malicious-site.test",
		},
		body: JSON.stringify({ content: "Memory with foreign origin" }),
	});
	const resForeign = await POST(reqForeignOrigin);
	assert.equal(resForeign.status, 201);

	// 2. Origin: null
	const reqNullOrigin = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "null",
		},
		body: JSON.stringify({ content: "Memory with null origin" }),
	});
	const resNull = await POST(reqNullOrigin);
	assert.equal(resNull.status, 201);

	// 3. Missing Origin
	const reqMissingOrigin = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({ content: "Memory with missing origin" }),
	});
	const resMissing = await POST(reqMissingOrigin);
	assert.equal(resMissing.status, 201);

	assert.equal(spyCalls.createManualMemory.length, 3);
});

test("[Header Characterization] PATCH and DELETE execute downstream calls regardless of text/plain content-type or foreign Origin", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: {
			"content-type": "text/plain",
			origin: "https://attacker.com",
		},
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 200);
	assert.equal(spyCalls.setUserMemoryPinned.length, 1);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: {
			"content-type": "text/plain",
			origin: "https://attacker.com",
		},
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 200);
	assert.equal(spyCalls.deleteUserMemory.length, 1);
});

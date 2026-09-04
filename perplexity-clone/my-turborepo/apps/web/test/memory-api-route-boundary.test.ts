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

// Helper to make headers for POST/PATCH/DELETE
function makeHeaders(headers: Record<string, string> = {}): Headers {
	const defaultHeaders: Record<string, string> = {
		"content-type": "application/json",
		origin: "http://localhost:3000",
		...headers,
	};
	return new Headers(defaultHeaders);
}

// --- BASE ROUTE FUNCTIONALITY SUITE ---
test("[Mocked Route Dispatch] Unauthenticated requests return 401 and execute 0 downstream handler calls", async () => {
	resetSpies();
	mockSessionUser = null;

	const reqGet = new Request("http://localhost:3000/api/memory");
	const resGet = await GET(reqGet);
	assert.equal(resGet.status, 401);

	const reqPost = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders(),
		body: JSON.stringify({ content: "I prefer dark mode" }),
	});
	const resPost = await POST(reqPost);
	assert.equal(resPost.status, 401);

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: makeHeaders(),
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 401);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: makeHeaders(),
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
		headers: makeHeaders(),
		body: JSON.stringify({
			content: "I live in Berlin",
			userId: USER_ATTACKER,
			confirmed: true,
			memoryKey: "manual.override",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	const data = (await res.json()) as { memory: { id: string; content: string } };

	assert.equal(data.memory.id, "mem-new-999");
	assert.equal(data.memory.content, "I live in Berlin");
	assert.equal("userId" in data.memory, false, "Response DTO must not contain userId field");

	assert.equal(spyCalls.createManualMemory.length, 1);
	assert.equal(spyCalls.createManualMemory[0]!.userId, USER_OWNER, "Downstream call must use session user ID");
});

test("[Mocked Route Dispatch] Malformed JSON with valid integrity headers fails with 400 INVALID_JSON", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqBadJson = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders(),
		body: "{ invalid json ...",
	});
	const resBadJson = await POST(reqBadJson);
	assert.equal(resBadJson.status, 400);
	const badJsonData = (await resBadJson.json()) as { error: { code: string } };
	assert.equal(badJsonData.error.code, "INVALID_JSON");

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[Mocked Route Dispatch] Validation error after integrity checks pass returns 400 VALIDATION_ERROR", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqShort = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders(),
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
		headers: makeHeaders(),
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
		headers: makeHeaders(),
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 404);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: makeHeaders(),
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

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: makeHeaders(),
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 200);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: makeHeaders(),
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 200);

	assert.equal(spyCalls.setUserMemoryPinned.length, 1);
	assert.equal(spyCalls.deleteUserMemory.length, 1);
});

// --- SERVER-ENFORCED REQUEST INTEGRITY & CSRF SECURITY SUITE ---

test("[CSRF & Integrity] Trusted same-origin POST, PATCH, and DELETE succeed with application/json", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqPost = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({ origin: "http://localhost:3000", "content-type": "application/json" }),
		body: JSON.stringify({ content: "Valid same-origin POST" }),
	});
	const resPost = await POST(reqPost);
	assert.equal(resPost.status, 201);

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: makeHeaders({ origin: "http://localhost:3000", "content-type": "application/json" }),
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 200);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: makeHeaders({ origin: "http://localhost:3000", "content-type": "application/json" }),
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 200);

	assert.equal(spyCalls.createManualMemory.length, 1);
	assert.equal(spyCalls.setUserMemoryPinned.length, 1);
	assert.equal(spyCalls.deleteUserMemory.length, 1);
});

test("[CSRF & Integrity] Foreign Origin is rejected with HTTP 403 CSRF_REJECTED for POST, PATCH, DELETE", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const foreignOrigins = [
		"https://attacker.com",
		"http://evil.site.test",
		"http://localhost:3000.attacker.com",
		"http://attacker.com/localhost:3000",
	];

	for (const origin of foreignOrigins) {
		const reqPost = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: makeHeaders({ origin }),
			body: JSON.stringify({ content: "Cross-site POST attack" }),
		});
		const resPost = await POST(reqPost);
		assert.equal(resPost.status, 403, `POST with origin '${origin}' must be 403`);
		const dataPost = (await resPost.json()) as { error: { code: string } };
		assert.equal(dataPost.error.code, "CSRF_REJECTED");

		const reqPatch = new Request("http://localhost:3000/api/memory", {
			method: "PATCH",
			headers: makeHeaders({ origin }),
			body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
		});
		const resPatch = await PATCH(reqPatch);
		assert.equal(resPatch.status, 403, `PATCH with origin '${origin}' must be 403`);

		const reqDelete = new Request("http://localhost:3000/api/memory", {
			method: "DELETE",
			headers: makeHeaders({ origin }),
			body: JSON.stringify({ id: OWNER_MEMORY_ID }),
		});
		const resDelete = await DELETE(reqDelete);
		assert.equal(resDelete.status, 403, `DELETE with origin '${origin}' must be 403`);
	}

	assert.equal(spyCalls.createManualMemory.length, 0, "No downstream creates should execute");
	assert.equal(spyCalls.setUserMemoryPinned.length, 0, "No downstream patches should execute");
	assert.equal(spyCalls.deleteUserMemory.length, 0, "No downstream deletes should execute");
});

test("[CSRF & Integrity] Opaque or literal Origin: null is rejected with HTTP 403 CSRF_REJECTED", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({ origin: "null" }),
		body: JSON.stringify({ content: "Null origin attack" }),
	});

	const res = await POST(req);
	assert.equal(res.status, 403);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "CSRF_REJECTED");

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Malformed or invalid Origin is rejected with HTTP 403 CSRF_REJECTED", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const invalidOrigins = [
		"javascript:alert(1)",
		"not-a-valid-url",
		"http://user:password@localhost:3000",
		"ftp://localhost:3000",
	];

	for (const origin of invalidOrigins) {
		const req = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: makeHeaders({ origin }),
			body: JSON.stringify({ content: "Malformed origin payload" }),
		});
		const res = await POST(req);
		assert.equal(res.status, 403, `Origin '${origin}' must be 403`);
		const data = (await res.json()) as { error: { code: string } };
		assert.equal(data.error.code, "CSRF_REJECTED");
	}

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Missing Origin and missing Referer is rejected with HTTP 403; valid trusted Referer succeeds", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	// 1. Missing both Origin and Referer
	const reqMissingBoth = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "Missing origin and referer" }),
	});
	const resMissing = await POST(reqMissingBoth);
	assert.equal(resMissing.status, 403);
	const dataMissing = (await resMissing.json()) as { error: { code: string } };
	assert.equal(dataMissing.error.code, "CSRF_REJECTED");

	// 2. Valid trusted Referer without Origin
	const reqReferer = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json", referer: "http://localhost:3000/dashboard" },
		body: JSON.stringify({ content: "Valid referer memory" }),
	});
	const resReferer = await POST(reqReferer);
	assert.equal(resReferer.status, 201);

	// 3. Foreign Referer without Origin
	const reqForeignReferer = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json", referer: "http://attacker.com/page" },
		body: JSON.stringify({ content: "Foreign referer memory" }),
	});
	const resForeignReferer = await POST(reqForeignReferer);
	assert.equal(resForeignReferer.status, 403);

	assert.equal(spyCalls.createManualMemory.length, 1);
	assert.equal(spyCalls.createManualMemory[0]!.content, "Valid referer memory");
});

test("[CSRF & Integrity] Same-site but different-origin subdomain is rejected with HTTP 403", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqSubdomain = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({ origin: "http://subdomain.localhost:3000" }),
		body: JSON.stringify({ content: "Subdomain attack" }),
	});

	const res = await POST(reqSubdomain);
	assert.equal(res.status, 403);
	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Spoofed Host header does not make a foreign Origin trusted", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqSpoofedHost = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({
			host: "evil-attacker.com",
			origin: "http://evil-attacker.com",
		}),
		body: JSON.stringify({ content: "Spoofed Host attack" }),
	});

	const res = await POST(reqSpoofedHost);
	assert.equal(res.status, 403);
	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Spoofed forwarded-host or forwarded-proto headers do not authorize a request", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqSpoofedForwarded = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({
			"x-forwarded-host": "attacker.com",
			"x-forwarded-proto": "https",
			origin: "https://attacker.com",
		}),
		body: JSON.stringify({ content: "Spoofed X-Forwarded attack" }),
	});

	const res = await POST(reqSpoofedForwarded);
	assert.equal(res.status, 403);
	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Missing Content-Type is rejected with HTTP 415 UNSUPPORTED_MEDIA_TYPE", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqMissingCt = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { origin: "http://localhost:3000" },
		body: JSON.stringify({ content: "Missing Content-Type" }),
	});
	reqMissingCt.headers.delete("content-type");

	const res = await POST(reqMissingCt);
	assert.equal(res.status, 415);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "UNSUPPORTED_MEDIA_TYPE");

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] text/plain Content-Type is rejected with HTTP 415 UNSUPPORTED_MEDIA_TYPE", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const reqTextPlain = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({ "content-type": "text/plain" }),
		body: JSON.stringify({ content: "text/plain payload" }),
	});

	const res = await POST(reqTextPlain);
	assert.equal(res.status, 415);
	const data = (await res.json()) as { error: { code: string } };
	assert.equal(data.error.code, "UNSUPPORTED_MEDIA_TYPE");

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] Form content types are rejected with HTTP 415 UNSUPPORTED_MEDIA_TYPE", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const formTypes = [
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=----WebKitFormBoundary",
		"text/html",
	];

	for (const ct of formTypes) {
		const req = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: makeHeaders({ "content-type": ct }),
			body: "content=FormPayload",
		});
		const res = await POST(req);
		assert.equal(res.status, 415, `Content-Type '${ct}' must be 415`);
		const data = (await res.json()) as { error: { code: string } };
		assert.equal(data.error.code, "UNSUPPORTED_MEDIA_TYPE");
	}

	assert.equal(spyCalls.createManualMemory.length, 0);
});

test("[CSRF & Integrity] application/json and application/json; charset=utf-8 succeed with HTTP 201/200", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const validContentTypes = [
		"application/json",
		"application/json; charset=utf-8",
		"APPLICATION/JSON; CHARSET=UTF-8",
	];

	for (const ct of validContentTypes) {
		const req = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: makeHeaders({ "content-type": ct }),
			body: JSON.stringify({ content: "Valid Content-Type memory" }),
		});
		const res = await POST(req);
		assert.equal(res.status, 201);
	}

	assert.equal(spyCalls.createManualMemory.length, 3);
});

test("[CSRF & Integrity] GET remains read-only and does not acquire mutation-only origin/content-type requirements", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	// GET without origin or content-type
	const reqGet = new Request("http://localhost:3000/api/memory?limit=5");
	const resGet = await GET(reqGet);
	assert.equal(resGet.status, 200);

	assert.equal(spyCalls.listUserMemories.length, 1);
});

test("[CSRF & Integrity] No response exposes permissive wildcard credentialed CORS behavior", async () => {
	resetSpies();
	mockSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: makeHeaders({ origin: "http://attacker.com" }),
		body: JSON.stringify({ content: "CORS test" }),
	});
	const res = await POST(req);
	assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
	assert.notEqual(res.headers.get("access-control-allow-origin"), "http://attacker.com");
});

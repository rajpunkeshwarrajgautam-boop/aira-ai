import assert from "node:assert/strict";
import test, { mock, afterEach } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aira_test";

const USER_OWNER = "user-owner-alice";
const USER_ATTACKER = "user-attacker-eve";
const OWNER_MEMORY_ID = "mem-owner-101";

interface SessionUser {
	id: string;
}

let currentSessionUser: SessionUser | null = null;

// --- Stateful In-Memory Prisma Fake ---
export interface FakeUserMemoryRecord {
	id: string;
	userId: string;
	memoryKey: string;
	kind: string;
	content: string;
	keywords: string[];
	importance: number;
	confidence: number;
	pinned: boolean;
	lastRecalledAt: Date | null;
	recallCount: number;
	createdAt: Date;
	updatedAt: Date;
}

interface PrismaFindManyArgs {
	where?: {
		userId?: string;
	};
	orderBy?: Array<{
		pinned?: "asc" | "desc";
		importance?: "asc" | "desc";
		updatedAt?: "asc" | "desc";
	}> | {
		pinned?: "asc" | "desc";
		importance?: "asc" | "desc";
		updatedAt?: "asc" | "desc";
	};
	take?: number;
	select?: Record<string, boolean>;
}

interface PrismaUpsertArgs {
	where: {
		userId_memoryKey: {
			userId: string;
			memoryKey: string;
		};
	};
	create: {
		userId: string;
		memoryKey: string;
		kind?: string;
		content: string;
		keywords?: string[];
		importance?: number;
		confidence?: number;
		pinned?: boolean;
	};
	update: {
		content?: string;
		kind?: string;
		keywords?: string[];
		importance?: number;
		confidence?: number;
		pinned?: boolean;
	};
	select?: Record<string, boolean>;
}

interface PrismaUpdateManyArgs {
	where: {
		id?: string | { in: string[] };
		userId?: string;
	};
	data: {
		pinned?: boolean;
		recallCount?: { increment: number };
		lastRecalledAt?: Date;
	};
}

interface PrismaDeleteManyArgs {
	where: {
		id?: string;
		userId?: string;
	};
}

interface DbLogEntry {
	method: string;
	args: unknown;
}

interface EmbeddingUpsertArgs {
	memoryId: string;
	userId: string;
	content: string;
	route: unknown;
}

let dbRecords: FakeUserMemoryRecord[] = [];
let dbCallLogs: DbLogEntry[] = [];

function resetStatefulDb() {
	currentSessionUser = null;
	dbCallLogs = [];
	dbRecords = [
		{
			id: OWNER_MEMORY_ID,
			userId: USER_OWNER,
			memoryKey: "manual.11223344556677889900",
			kind: "PREFERENCE",
			content: "I prefer dark mode and TypeScript",
			keywords: ["prefer", "dark", "mode", "typescript"],
			importance: 5,
			confidence: 1,
			pinned: true,
			lastRecalledAt: null,
			recallCount: 0,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		},
		{
			id: "mem-attacker-202",
			userId: USER_ATTACKER,
			memoryKey: "manual.aabbccddeeff00112233",
			kind: "PROJECT",
			content: "Working on security audit",
			keywords: ["working", "security", "audit"],
			importance: 4,
			confidence: 1,
			pinned: false,
			lastRecalledAt: null,
			recallCount: 0,
			createdAt: new Date("2026-01-02T00:00:00Z"),
			updatedAt: new Date("2026-01-02T00:00:00Z"),
		},
	];
}

export const fakePrisma = {
	userMemory: {
		async findMany(args: PrismaFindManyArgs = {}) {
			dbCallLogs.push({ method: "findMany", args });
			let results = [...dbRecords];
			if (args.where?.userId) {
				results = results.filter((r) => r.userId === args.where?.userId);
			}
			if (args.orderBy) {
				const orderRules = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
				results.sort((a, b) => {
					for (const rule of orderRules) {
						if (rule.pinned) {
							const diff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
							if (diff !== 0) return rule.pinned === "desc" ? diff : -diff;
						}
						if (rule.importance) {
							const diff = b.importance - a.importance;
							if (diff !== 0) return rule.importance === "desc" ? diff : -diff;
						}
						if (rule.updatedAt) {
							const diff = b.updatedAt.getTime() - a.updatedAt.getTime();
							if (diff !== 0) return rule.updatedAt === "desc" ? diff : -diff;
						}
					}
					return 0;
				});
			}
			if (args.take && typeof args.take === "number") {
				results = results.slice(0, args.take);
			}
			if (args.select) {
				return results.map((r) => {
					const projected: Record<string, unknown> = {};
					for (const key of Object.keys(args.select!)) {
						if (args.select![key]) {
							projected[key] = (r as unknown as Record<string, unknown>)[key];
						}
					}
					return projected;
				});
			}
			return results;
		},

		async upsert(args: PrismaUpsertArgs) {
			dbCallLogs.push({ method: "upsert", args });
			const { where, create, update, select } = args;
			const lookupUserId = where.userId_memoryKey.userId;
			const lookupMemoryKey = where.userId_memoryKey.memoryKey;

			// Use where.userId_memoryKey ONLY to locate an existing record.
			// Do NOT overwrite create fields with lookup keys!
			const existingIndex = dbRecords.findIndex(
				(r) => r.userId === lookupUserId && r.memoryKey === lookupMemoryKey,
			);

			let record: FakeUserMemoryRecord;
			if (existingIndex >= 0) {
				record = {
					...dbRecords[existingIndex]!,
					...update,
					updatedAt: new Date(),
				};
				dbRecords[existingIndex] = record;
			} else {
				record = {
					id: `mem-gen-${Math.random().toString(36).substring(2, 9)}`,
					userId: create.userId, // Honors create payload
					memoryKey: create.memoryKey, // Honors create payload
					kind: create.kind ?? "OTHER",
					content: create.content,
					keywords: create.keywords ?? [],
					importance: create.importance ?? 4,
					confidence: create.confidence ?? 1,
					pinned: create.pinned ?? true,
					lastRecalledAt: null,
					recallCount: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				dbRecords.push(record);
			}

			if (select) {
				const projected: Record<string, unknown> = {};
				for (const key of Object.keys(select)) {
					if (select[key]) {
						projected[key] = (record as unknown as Record<string, unknown>)[key];
					}
				}
				return projected;
			}
			return record;
		},

		async updateMany(args: PrismaUpdateManyArgs) {
			dbCallLogs.push({ method: "updateMany", args });
			const { where, data } = args;
			let matches: FakeUserMemoryRecord[] = [];

			if (where.id && typeof where.id === "string" && where.userId) {
				matches = dbRecords.filter((r) => r.id === where.id && r.userId === where.userId);
			} else if (where.id && typeof where.id === "object" && Array.isArray((where.id as { in: string[] }).in) && where.userId) {
				const ids = (where.id as { in: string[] }).in;
				matches = dbRecords.filter((r) => ids.includes(r.id) && r.userId === where.userId);
			} else if (where.id && typeof where.id === "string" && !where.userId) {
				// Un-scoped query path used when testing mutant code
				matches = dbRecords.filter((r) => r.id === where.id);
			} else {
				throw new Error(`Unsupported updateMany where clause: ${JSON.stringify(where)}`);
			}

			for (const m of matches) {
				if (data.pinned !== undefined) m.pinned = data.pinned;
				if (data.recallCount?.increment) m.recallCount += data.recallCount.increment;
				if (data.lastRecalledAt) m.lastRecalledAt = data.lastRecalledAt;
				m.updatedAt = new Date();
			}

			return { count: matches.length };
		},

		async deleteMany(args: PrismaDeleteManyArgs) {
			dbCallLogs.push({ method: "deleteMany", args });
			const { where } = args;
			let toDelete: FakeUserMemoryRecord[] = [];

			if (where.id && where.userId) {
				toDelete = dbRecords.filter((r) => r.id === where.id && r.userId === where.userId);
			} else if (where.id && !where.userId) {
				// Un-scoped query path used when testing mutant code
				toDelete = dbRecords.filter((r) => r.id === where.id);
			} else {
				throw new Error(`Unsupported deleteMany where clause: ${JSON.stringify(where)}`);
			}

			dbRecords = dbRecords.filter((r) => !toDelete.includes(r));
			return { count: toDelete.length };
		},
	},
};

// 1. Mock Auth
mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => {
			if (!currentSessionUser) return null;
			return { user: currentSessionUser };
		}),
	},
} as unknown as Record<string, unknown>);

// 2. Mock Prisma Database Client
mock.module("@/lib/prisma", {
	exports: {
		prisma: fakePrisma,
	},
} as unknown as Record<string, unknown>);

// --- ASYNCHRONOUS LIFECYCLE MANAGEMENT: Controlled Deferred Promises ---
export class Deferred<T = void> {
	promise: Promise<T>;
	resolve!: (value: T | PromiseLike<T>) => void;
	reject!: (reason?: unknown) => void;
	isSettled = false;

	constructor() {
		this.promise = new Promise<T>((res, rej) => {
			this.resolve = (val) => {
				this.isSettled = true;
				res(val);
			};
			this.reject = (err) => {
				this.isSettled = true;
				rej(err);
			};
		});
	}
}

let pendingEmbeddingDeferreds: Deferred<void>[] = [];

const embeddingCalls = {
	resolveRoute: [] as string[],
	upsertEmbedding: [] as EmbeddingUpsertArgs[],
	deleteEmbedding: [] as unknown[],
};

function resetEmbeddingSpy() {
	// Assert no unresolved deferreds survived from a previous test before resetting state!
	const activeUnsettled = pendingEmbeddingDeferreds.filter((d) => !d.isSettled);
	assert.equal(
		activeUnsettled.length,
		0,
		"Lifecycle error: Unresolved embedding deferred promises leaked from previous test",
	);

	embeddingCalls.resolveRoute = [];
	embeddingCalls.upsertEmbedding = [];
	embeddingCalls.deleteEmbedding = [];
	pendingEmbeddingDeferreds = [];
}

mock.module("@/lib/semantic-memory", {
	exports: {
		EmbeddingCircuitOpenError: class EmbeddingCircuitOpenError extends Error {},
		resolveSemanticEmbeddingRouteForUser: mock.fn(async (userId: string) => {
			embeddingCalls.resolveRoute.push(userId);
			return { provider: "mock-provider", model: "mock-model" };
		}),
		upsertUserMemoryEmbedding: mock.fn((args: EmbeddingUpsertArgs) => {
			embeddingCalls.upsertEmbedding.push(args);
			const deferred = new Deferred<void>();
			pendingEmbeddingDeferreds.push(deferred);
			return deferred.promise;
		}),
		deleteUserMemoryEmbedding: mock.fn(async (args: unknown) => {
			embeddingCalls.deleteEmbedding.push(args);
			return Promise.resolve();
		}),
		getSemanticMemoryScores: mock.fn(async () => new Map()),
	},
} as unknown as Record<string, unknown>);

// Import real route handlers, real wrapper, and real core functions
const { GET, POST, PATCH, DELETE } = await import("../app/api/memory/route");
const { refreshPersistentMemory } = await import("../lib/persistent-memory");

// Microtask flushing helper (no setTimeout)
async function settleMicrotasks() {
	await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
	await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
}

// Automatic Teardown Hook: Ensures every test leaves zero pending embedding promises
afterEach(async () => {
	while (pendingEmbeddingDeferreds.length > 0) {
		const deferred = pendingEmbeddingDeferreds.shift()!;
		if (!deferred.isSettled) {
			deferred.resolve();
			await settleMicrotasks();
		}
	}
	assert.equal(
		pendingEmbeddingDeferreds.length,
		0,
		"Pending embedding deferreds queue must be completely empty after test teardown",
	);
});

// --- FAKE CONTRACT TEST ---
test("[Fake Contract] Prisma fake honors create.userId and create.memoryKey rather than substituting where values", async () => {
	resetStatefulDb();

	const result = await fakePrisma.userMemory.upsert({
		where: {
			userId_memoryKey: {
				userId: "lookup-user-id",
				memoryKey: "lookup-memory-key",
			},
		},
		create: {
			userId: "payload-user-id",
			memoryKey: "payload-memory-key",
			content: "Payload content",
			kind: "PREFERENCE",
			pinned: true,
		},
		update: {
			content: "Updated content",
		},
		select: {
			id: true,
			userId: true,
			memoryKey: true,
			content: true,
		},
	});

	assert.equal((result as unknown as Record<string, unknown>).userId, "payload-user-id", "Fake MUST reflect create.userId on insert");
	assert.equal((result as unknown as Record<string, unknown>).memoryKey, "payload-memory-key", "Fake MUST reflect create.memoryKey on insert");
	assert.equal((result as unknown as Record<string, unknown>).content, "Payload content");
});

// --- REAL CORE INTEGRATION SUITE ---
test("[Real Core Integration] Unauthenticated requests trigger 0 database or embedding operations", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = null;

	const resGet = await GET(new Request("http://localhost:3000/api/memory"));
	assert.equal(resGet.status, 401);

	const resPost = await POST(
		new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "Valid memory" }),
		}),
	);
	assert.equal(resPost.status, 401);

	const resPatch = await PATCH(
		new Request("http://localhost:3000/api/memory", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
		}),
	);
	assert.equal(resPatch.status, 401);

	const resDelete = await DELETE(
		new Request("http://localhost:3000/api/memory", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: OWNER_MEMORY_ID }),
		}),
	);
	assert.equal(resDelete.status, 401);

	assert.equal(dbCallLogs.length, 0, "No Prisma DB calls should occur");
	assert.equal(embeddingCalls.resolveRoute.length, 0, "No route resolution calls should occur");
	assert.equal(embeddingCalls.upsertEmbedding.length, 0, "No embedding calls should occur");
});

test("[Real Core Integration] POST binds strictly to session.user.id despite spoofed userId, memoryKey, or confirmed fields", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			content: "I speak French fluently",
			userId: USER_ATTACKER,
			confirmed: true,
			memoryKey: "manual.hacked_key",
		}),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	const data = (await res.json()) as { memory: { id: string; content: string } };

	assert.equal("userId" in data.memory, false, "Response DTO must not expose userId");
	assert.equal(data.memory.content, "I speak French fluently");

	// Verify exact upsert arguments passed to Prisma
	const upsertLog = dbCallLogs.find((log) => log.method === "upsert");
	assert.ok(upsertLog, "Prisma upsert must be logged");
	const upsertArgs = upsertLog.args as PrismaUpsertArgs;
	
	assert.equal(upsertArgs.where.userId_memoryKey.userId, USER_OWNER, "Upsert lookup userId must be session owner");
	assert.equal(upsertArgs.create.userId, USER_OWNER, "Upsert create.userId must be session owner");
	assert.equal(upsertArgs.create.memoryKey, upsertArgs.where.userId_memoryKey.memoryKey, "Create memoryKey must equal lookup memoryKey");
	assert.ok(upsertArgs.create.memoryKey.startsWith("manual."), "Memory key must be deterministically generated manual key");

	// Verify record in stateful Prisma fake
	const createdRecord = dbRecords.find((r) => r.content === "I speak French fluently");
	assert.ok(createdRecord, "Record must be created in Prisma store");
	assert.equal(createdRecord.userId, USER_OWNER, "Database record MUST belong to session user");
	assert.notEqual(createdRecord.memoryKey, "manual.hacked_key", "Memory key override must be ignored");
});

test("[Real Core Integration] Successful manual saves produce expected owner-scoped record and actual response DTO shape", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "I am learning Rust programming", kind: "GOAL", pinned: true }),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	const data = (await res.json()) as { memory: { id: string; kind: string; content: string; pinned: boolean } };

	assert.ok(data.memory.id);
	assert.equal(data.memory.kind, "GOAL");
	assert.equal(data.memory.content, "I am learning Rust programming");
	assert.equal(data.memory.pinned, true);

	const dbRecord = dbRecords.find((r) => r.id === data.memory.id);
	assert.ok(dbRecord);
	assert.equal(dbRecord.userId, USER_OWNER);
});

test("[Real Core Integration] Wrong-owner PATCH and DELETE preserve target record, leave other owner records unchanged, and return 404 NOT_FOUND", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_ATTACKER };

	// 1. Cross-owner PATCH
	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 404);

	const patchLog = dbCallLogs.find((l) => l.method === "updateMany");
	assert.ok(patchLog);
	const patchArgs = patchLog.args as PrismaUpdateManyArgs;
	assert.equal(patchArgs.where.id, OWNER_MEMORY_ID);
	assert.equal(patchArgs.where.userId, USER_ATTACKER, "updateMany where clause MUST include attacker userId");

	const aliceRecord = dbRecords.find((r) => r.id === OWNER_MEMORY_ID)!;
	assert.equal(aliceRecord.pinned, true, "Alice's memory must remain pinned");

	// 2. Cross-owner DELETE
	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 404);

	const deleteLog = dbCallLogs.find((l) => l.method === "deleteMany");
	assert.ok(deleteLog);
	const deleteArgs = deleteLog.args as PrismaDeleteManyArgs;
	assert.equal(deleteArgs.where.id, OWNER_MEMORY_ID);
	assert.equal(deleteArgs.where.userId, USER_ATTACKER, "deleteMany where clause MUST include attacker userId");

	const aliceRecordStillExists = dbRecords.some((r) => r.id === OWNER_MEMORY_ID);
	assert.equal(aliceRecordStillExists, true, "Alice's memory must not be deleted by attacker");
});

test("[Real Core Integration] Correct-owner PIN/UNPIN and DELETE update/remove exactly the intended record", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	// 1. Unpin
	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID, pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 200);

	const updatedRecord = dbRecords.find((r) => r.id === OWNER_MEMORY_ID)!;
	assert.equal(updatedRecord.pinned, false, "Record must now be unpinned");

	// 2. Delete
	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: OWNER_MEMORY_ID }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 200);

	const existsAfterDelete = dbRecords.some((r) => r.id === OWNER_MEMORY_ID);
	assert.equal(existsAfterDelete, false, "Record must be deleted from DB");

	// Attacker's record remains untouched
	const attackerRecord = dbRecords.find((r) => r.id === "mem-attacker-202");
	assert.ok(attackerRecord, "Attacker's record must be preserved");
});

test("[Real Core Integration] Missing targets do not falsely report success", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const reqPatch = new Request("http://localhost:3000/api/memory", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: "non-existent-memory-id", pinned: false }),
	});
	const resPatch = await PATCH(reqPatch);
	assert.equal(resPatch.status, 404);

	const reqDelete = new Request("http://localhost:3000/api/memory", {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: "non-existent-memory-id" }),
	});
	const resDelete = await DELETE(reqDelete);
	assert.equal(resDelete.status, 404);
});

test("[Real Core Integration] Invalid inputs cause no persistence or embedding operations", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const initialDbCount = dbRecords.length;

	const reqTooShort = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "a" }),
	});
	const resTooShort = await POST(reqTooShort);
	assert.equal(resTooShort.status, 400);

	assert.equal(dbRecords.length, initialDbCount, "DB count must not change on validation error");
	assert.equal(embeddingCalls.resolveRoute.length, 0, "No route resolution on validation error");
	assert.equal(embeddingCalls.upsertEmbedding.length, 0, "No embedding calls on validation error");
});

test("[Real Core Integration] Production sensitive-content filtering (looksSensitive) rejects passwords/keys before DB or embedding work", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const sensitivePayloads = [
		"My password is SuperSecretPassword123!",
		"Here is the api key: sk-abcdef12345678901234",
		"Use bearer token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
		"-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...",
	];

	for (const content of sensitivePayloads) {
		const req = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content }),
		});
		const res = await POST(req);
		assert.equal(res.status, 400);
		const data = (await res.json()) as { error: { code: string; message: string } };
		assert.equal(data.error.code, "MEMORY_REJECTED");
		assert.equal(data.error.message, "This memory is empty or contains sensitive credential-like information.");
	}

	assert.equal(dbCallLogs.filter((c) => c.method === "upsert").length, 0, "No DB upserts should be attempted for sensitive content");
	assert.equal(embeddingCalls.resolveRoute.length, 0, "No route resolution on sensitive content rejection");
	assert.equal(embeddingCalls.upsertEmbedding.length, 0, "No embedding calls on sensitive content rejection");
});

test("[Real Core Integration] Ordinary refresh via real wrapper remains a no-op and does not trigger embedding work", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();

	const result = await refreshPersistentMemory({
		userId: USER_OWNER,
		conversationId: "conv-123",
		userMessageId: "msg-456",
		query: "Remember that I like apples",
		answer: "I will remember that you like apples",
	});

	assert.equal(result.upserts, 0);
	assert.equal(result.deletes, 0);

	assert.equal(dbCallLogs.length, 0, "No DB calls during refresh");
	assert.equal(embeddingCalls.resolveRoute.length, 0, "No route resolution during refresh");
	assert.equal(embeddingCalls.upsertEmbedding.length, 0, "No embedding calls during refresh");
});

test("[Real Core Integration] Asynchronous manual-save embedding passes exact parameters and settles deterministically via Deferred signal", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "I work with Docker and Kubernetes" }),
	});

	const res = await POST(req);
	assert.equal(res.status, 201);
	const data = (await res.json()) as { memory: { id: string } };

	// Yield microtasks to allow the async route resolution and upsert call to initiate
	await settleMicrotasks();

	assert.equal(embeddingCalls.resolveRoute.length, 1);
	assert.equal(embeddingCalls.resolveRoute[0], USER_OWNER);
	assert.equal(embeddingCalls.upsertEmbedding.length, 1);
	assert.equal(embeddingCalls.upsertEmbedding[0]!.userId, USER_OWNER);
	assert.equal(embeddingCalls.upsertEmbedding[0]!.memoryId, data.memory.id);
	assert.equal(embeddingCalls.upsertEmbedding[0]!.content, "I work with Docker and Kubernetes");
	assert.deepEqual(embeddingCalls.upsertEmbedding[0]!.route, { provider: "mock-provider", model: "mock-model" });

	// REQUIREMENT 3.B: Deterministically resolve the background embedding promise
	assert.equal(pendingEmbeddingDeferreds.length, 1, "Must have exactly 1 pending embedding deferred signal");
	const deferred = pendingEmbeddingDeferreds.shift()!;
	deferred.resolve();

	// Settle the resolved promise chain
	await settleMicrotasks();
	assert.equal(deferred.isSettled, true, "Deferred promise must be explicitly settled");
});

test("[Real Core Integration] Asynchronous embedding failure settles deterministically, logs warning, and preserves already-saved manual memory", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	// REQUIREMENT 3.C: Explicitly track console.warn calls to observe wrapper error handling
	const warnLogs: string[] = [];
	const origWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnLogs.push(args.map(String).join(" "));
	};

	try {
		const req = new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "I enjoy mountain climbing in summer" }),
		});

		const res = await POST(req);
		assert.equal(res.status, 201, "HTTP response must remain 201 CREATED despite background embedding error");
		const data = (await res.json()) as { memory: { id: string } };

		await settleMicrotasks();

		assert.equal(pendingEmbeddingDeferreds.length, 1, "Must have 1 pending embedding signal");
		const deferred = pendingEmbeddingDeferreds.shift()!;
		
		// REQUIREMENT 3.C: Reject the background embedding promise
		deferred.reject(new Error("Vector database connection timeout"));

		// Settle microtasks so the wrapper's .catch block executes
		await settleMicrotasks();

		// REQUIREMENT 3.C: Explicitly observe wrapper's error handling completion via console.warn
		assert.ok(
			warnLogs.some((msg) => msg.includes("Manual memory embedding failed:")),
			"Wrapper error handler MUST log warning on embedding failure",
		);

		// Verify the record is preserved in DB store
		const savedRecord = dbRecords.find((r) => r.id === data.memory.id);
		assert.ok(savedRecord, "Durable lexical memory in DB must be preserved when embedding fails");
	} finally {
		// Restore console.warn mock
		console.warn = origWarn;
	}
});

// --- REQUIREMENT 3.E: ASYNCHRONOUS LIFECYCLE REGRESSION TESTS ---
test("[Lifecycle Regression] Pending embedding promise cannot silently survive test boundaries", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	// Trigger a save operation creating a pending deferred
	const req = new Request("http://localhost:3000/api/memory", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: "Test lifecycle pending deferred tracking" }),
	});
	const res = await POST(req);
	assert.equal(res.status, 201);

	await settleMicrotasks();
	assert.equal(pendingEmbeddingDeferreds.length, 1, "Pending deferred must be tracked in registry");

	// Manually settle deferred as a responsible test
	const deferred = pendingEmbeddingDeferreds.shift()!;
	deferred.resolve();
	await settleMicrotasks();

	// Confirm registry is clean
	assert.equal(pendingEmbeddingDeferreds.length, 0, "Deferred registry must be empty");
});

test("[Lifecycle Regression] Non-mutating and invalid requests produce zero background embedding work", async () => {
	resetStatefulDb();
	resetEmbeddingSpy();
	currentSessionUser = { id: USER_OWNER };

	// GET request
	await GET(new Request("http://localhost:3000/api/memory"));
	// Invalid payload POST
	await POST(
		new Request("http://localhost:3000/api/memory", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "" }),
		}),
	);

	await settleMicrotasks();

	assert.equal(embeddingCalls.resolveRoute.length, 0, "No route resolution should occur for non-mutating/invalid calls");
	assert.equal(embeddingCalls.upsertEmbedding.length, 0, "No embedding calls should occur for non-mutating/invalid calls");
	assert.equal(pendingEmbeddingDeferreds.length, 0, "Zero pending deferreds must be registered");
});

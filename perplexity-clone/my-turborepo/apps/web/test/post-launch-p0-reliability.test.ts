import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test, { mock } from "node:test";
import { compileFunction } from "node:vm";

// Mock Session User for Route Tests
let sessionUser: { id: string; email?: string } | null = {
	id: "usr_test_owner_a",
	email: "owner-a@example.com",
};

declare module "node:test" {
	interface MockModuleOptions {
		exports?: object;
	}
}

mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (sessionUser ? { user: sessionUser } : null)),
	},
});

type CoreModule = typeof import("../lib/persistent-memory-core");
type Subject = Pick<CoreModule, "getRelevantPersistentMemories">;
type MemoryRow = {
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
};
type Where = { userId: string; id?: string | { in: string[] }; memoryKey?: string };

function loadMemorySubject() {
	const rows: MemoryRow[] = [];
	let nextId = 1;
	const matches = (row: MemoryRow, where: Where) =>
		row.userId === where.userId &&
		(where.memoryKey === undefined || row.memoryKey === where.memoryKey) &&
		(where.id === undefined ||
			(typeof where.id === "string" ? row.id === where.id : where.id.in.includes(row.id)));
	const prisma = {
		userMemory: {
			findMany: async ({ where, take }: { where: Where; take: number }) => {
				return rows.filter((row) => matches(row, where)).slice(0, take).map((row) => ({ ...row }));
			},
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: { pinned?: boolean; lastRecalledAt?: Date; recallCount?: { increment: number } };
			}) => {
				const selected = rows.filter((row) => matches(row, where));
				for (const row of selected) {
					if (data.pinned !== undefined) row.pinned = data.pinned;
					if (data.lastRecalledAt) row.lastRecalledAt = data.lastRecalledAt;
					if (data.recallCount) row.recallCount += data.recallCount.increment;
				}
				return { count: selected.length };
			},
			deleteMany: async () => ({ count: 0 }),
			upsert: async () => ({ id: `mem-${nextId++}` }),
		},
	};
	const source = readFileSync(new URL("../lib/persistent-memory-core.ts", import.meta.url), "utf8");
	let executable = stripTypeScriptTypes(source, { mode: "strip" });
	executable = executable.replace('import { createHash } from "node:crypto";', "const { createHash } = dependencies.crypto;");
	executable = executable.replace('import { prisma } from "@/lib/prisma";', "const { prisma } = dependencies;");
	executable = executable.replace('import { UserMemoryKind } from "@/generated/prisma/enums";', "const { UserMemoryKind } = dependencies;");
	executable = executable.replace(/^export (?=(?:async )?function\b)/gm, "");
	const evaluate = compileFunction(
		executable + "\nreturn { getRelevantPersistentMemories };",
		["dependencies"],
		{ filename: "persistent-memory-core.ts (test runner)" },
	);
	const subject = evaluate({
		prisma,
		crypto: { createHash },
		UserMemoryKind: { OTHER: "OTHER" },
	}) as Subject;
	return { subject, rows };
}

// ---------------------------------------------------------------------------
// Behavioral Tests: Memory Recall & Isolation
// ---------------------------------------------------------------------------

test("P0-MEM-BEH-01: standalone greetings suppress recall of unrelated pinned memories", async () => {
	const { subject, rows } = loadMemorySubject();
	rows.push({
		id: "mem-qa-1",
		userId: "usr_test_owner_a",
		memoryKey: "qa_fashion_project",
		kind: "OTHER",
		content: "Working on a temporary QA project for fashion business landing page with 5L budget",
		keywords: ["qa", "project", "fashion", "business", "budget"],
		importance: 5,
		confidence: 1,
		pinned: true,
		lastRecalledAt: null,
		recallCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	const greetings = [
		"hi",
		"hello",
		"hey",
		"howdy",
		"good morning",
		"good evening",
		"thanks",
		"thank you",
		"how are you?",
		"what's up?",
	];
	for (const greeting of greetings) {
		const memories = await subject.getRelevantPersistentMemories("usr_test_owner_a", greeting);
		assert.deepEqual(
			memories,
			[],
			`Greeting '${greeting}' must return empty array, suppressing unrelated pinned memories`,
		);
	}
});

test("P0-MEM-BEH-02: genuinely relevant memory question retrieves authorized user memory", async () => {
	const { subject, rows } = loadMemorySubject();
	rows.push({
		id: "mem-qa-1",
		userId: "usr_test_owner_a",
		memoryKey: "qa_fashion_project",
		kind: "OTHER",
		content: "Working on a temporary QA project for fashion business landing page with 5L budget",
		keywords: ["qa", "project", "fashion", "business", "budget"],
		importance: 5,
		confidence: 1,
		pinned: true,
		lastRecalledAt: null,
		recallCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	const memories = await subject.getRelevantPersistentMemories(
		"usr_test_owner_a",
		"What is the budget for my fashion business project?",
	);
	assert.equal(memories.length, 1, "Must recall exactly 1 relevant memory");
	assert.ok(
		memories[0]?.includes("fashion business landing page with 5L budget"),
		"Recalled memory content must match user query",
	);
});

test("P0-MEM-BEH-02b: explicit showAll query recalls pinned and general memories", async () => {
	const { subject, rows } = loadMemorySubject();
	rows.push({
		id: "mem-qa-1",
		userId: "usr_test_owner_a",
		memoryKey: "qa_fashion_project",
		kind: "OTHER",
		content: "Working on a temporary QA project for fashion business landing page with 5L budget",
		keywords: ["qa", "project", "fashion", "business", "budget"],
		importance: 5,
		confidence: 1,
		pinned: true,
		lastRecalledAt: null,
		recallCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	const memories = await subject.getRelevantPersistentMemories(
		"usr_test_owner_a",
		"what do you remember about me?",
	);
	assert.equal(memories.length, 1, "Must recall memory when user explicitly asks what is remembered");
	assert.ok(memories[0]?.includes("fashion business landing page with 5L budget"));
});

test("P0-MEM-BEH-03: memory retrieval strictly enforces server-authoritative tenant isolation", async () => {
	const { subject, rows } = loadMemorySubject();
	rows.push({
		id: "mem-owner-a",
		userId: "usr_test_owner_a",
		memoryKey: "qa_fashion_project",
		kind: "OTHER",
		content: "Working on a temporary QA project for fashion business landing page with 5L budget",
		keywords: ["qa", "project", "fashion", "business", "budget"],
		importance: 5,
		confidence: 1,
		pinned: true,
		lastRecalledAt: null,
		recallCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	// User B asks the exact question that matches User A's memory
	const memoriesB = await subject.getRelevantPersistentMemories(
		"usr_test_owner_b",
		"What is the budget for my fashion business project?",
	);
	assert.deepEqual(
		memoriesB,
		[],
		"User B must receive empty array and cannot access User A's memory across tenant boundary",
	);
});

test("P0-MEM-BEH-04: route-core suppresses contextualMemory on standalone greetings", () => {
	const routeSource = readFileSync(
		new URL("../app/api/search/route-core.ts", import.meta.url),
		"utf8",
	);
	assert.ok(
		routeSource.includes("contextualMemory: context.chatHistory.length > 0 ? context.contextualMemory : []"),
		"route-core must not inject background contextualMemory on standalone greetings with empty chat history",
	);
});

// ---------------------------------------------------------------------------
// Behavioral Tests: Work Runtime Fail-Closed Guard
// ---------------------------------------------------------------------------

test("P0-WORK-BEH-01: POST /api/agent-platform/projects/[projectId]/runs returns 503 WORK_RUNTIME_UNAVAILABLE before project lookup", async () => {
	sessionUser = { id: "usr_test_owner_a", email: "owner-a@example.com" };
	const prevFlag = process.env.AIRA_WORK_RUNTIME_ENABLED;
	process.env.AIRA_WORK_RUNTIME_ENABLED = "false";

	try {
		const runsRoute = await import("../app/api/agent-platform/projects/[projectId]/runs/route");
		const req = new Request(
			"http://localhost:3000/api/agent-platform/projects/any-nonexistent-project-id/runs",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: "Execute autonomous workflow" }),
			},
		);

		const res = await runsRoute.POST(req, {
			params: Promise.resolve({ projectId: "any-nonexistent-project-id" }),
		});

		assert.equal(res.status, 503, "Status must be 503 Service Unavailable");
		const body = (await res.json()) as { error?: { code?: string; message?: string } };
		assert.equal(
			body.error?.code,
			"WORK_RUNTIME_UNAVAILABLE",
			"Must fail closed with WORK_RUNTIME_UNAVAILABLE before any project lookup",
		);
	} finally {
		if (prevFlag === undefined) {
			delete process.env.AIRA_WORK_RUNTIME_ENABLED;
		} else {
			process.env.AIRA_WORK_RUNTIME_ENABLED = prevFlag;
		}
	}
});

// ---------------------------------------------------------------------------
// Behavioral Tests: Billing Checkout Fail-Closed Guard
// ---------------------------------------------------------------------------

test("P0-BILL-BEH-01: POST /api/billing/checkout returns 503 CHECKOUT_DISABLED before payment provider mutation", async () => {
	sessionUser = { id: "usr_test_owner_a", email: "owner-a@example.com" };
	const prevFlag = process.env.CASHFREE_CHECKOUT_ENABLED;
	process.env.CASHFREE_CHECKOUT_ENABLED = "false";

	try {
		const checkoutRoute = await import("../app/api/billing/checkout/route");
		const req = new Request("http://localhost:3000/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				plan: "pro",
				customerPhone: "+919876543210",
			}),
		});

		const res = await checkoutRoute.POST(req);

		assert.equal(res.status, 503, "Status must be 503 Service Unavailable");
		const body = (await res.json()) as { error?: { code?: string; message?: string } };
		assert.equal(
			body.error?.code,
			"CHECKOUT_DISABLED",
			"Must fail closed with CHECKOUT_DISABLED before payment provider mutation",
		);
	} finally {
		if (prevFlag === undefined) {
			delete process.env.CASHFREE_CHECKOUT_ENABLED;
		} else {
			process.env.CASHFREE_CHECKOUT_ENABLED = prevFlag;
		}
	}
});

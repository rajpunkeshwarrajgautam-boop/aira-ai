/* eslint-disable turbo/no-undeclared-env-vars */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWebFile(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

function functionSection(source: string, functionName: string): string {
	const start = source.indexOf(`export async function ${functionName}`);
	assert.notEqual(start, -1, `${functionName} must exist`);

	const nextExport = source.indexOf("\nexport ", start + 1);
	return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

const OWNER_USER_ID = "user-owner-101";
const ATTACKER_USER_ID = "user-attacker-202";
const CONVERSATION_ID = "conv-test-999";

interface SessionUser {
	id: string;
}

let mockSessionUser: SessionUser | null = null;

const spyCalls = {
	getConversationOrThrow: [] as Array<{ userId: string; conversationId: string }>,
	prismaUpdate: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
};

function resetSpies() {
	mockSessionUser = null;
	spyCalls.getConversationOrThrow = [];
	spyCalls.prismaUpdate = [];
}

mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => {
			if (!mockSessionUser) return null;
			return { user: mockSessionUser };
		}),
	},
} as unknown as Record<string, unknown>);

mock.module("@/lib/conversation-memory", {
	exports: {
		getConversationOrThrow: mock.fn(async (userId: string, conversationId: string) => {
			spyCalls.getConversationOrThrow.push({ userId, conversationId });
			if (userId === OWNER_USER_ID && conversationId === CONVERSATION_ID) {
				return { id: conversationId, title: "Original Title" };
			}
			throw new Error("Conversation not found.");
		}),
	},
} as unknown as Record<string, unknown>);

mock.module("@/lib/prisma", {
	exports: {
		prisma: {
			conversation: {
				update: mock.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
					spyCalls.prismaUpdate.push(args);
					return {
						id: args.where.id,
						title: (args.data.title as string) ?? "Original Title",
						pinnedAt: (args.data.pinnedAt as Date) ?? null,
						archivedAt: (args.data.archivedAt as Date) ?? null,
						lastMessageAt: new Date("2026-09-25T12:00:00Z"),
						updatedAt: new Date("2026-09-25T12:00:00Z"),
					};
				}),
			},
		},
	},
} as unknown as Record<string, unknown>);

const { PATCH } = await import("../app/api/conversations/[conversationId]/route");

function makeJsonRequest(body: unknown): Request {
	return new Request("http://localhost:3000/api/conversations/" + CONVERSATION_ID, {
		method: "PATCH",
		headers: new Headers({ "content-type": "application/json" }),
		body: JSON.stringify(body),
	});
}

function makeParams(conversationId = CONVERSATION_ID): { params: Promise<{ conversationId: string }> } {
	return { params: Promise.resolve({ conversationId }) };
}

test("PATCH /api/conversations/[id] rejects unauthenticated callers with 401", async () => {
	resetSpies();
	mockSessionUser = null;
	const res = await PATCH(makeJsonRequest({ pinned: true }), makeParams());
	assert.equal(res.status, 401);
	const data = await res.json();
	assert.equal(data.error?.code, "UNAUTHENTICATED");
	assert.equal(spyCalls.prismaUpdate.length, 0);
});

test("PATCH /api/conversations/[id] rejects invalid pinned value with 400", async () => {
	resetSpies();
	mockSessionUser = { id: OWNER_USER_ID };
	const res = await PATCH(makeJsonRequest({ pinned: "invalid-boolean" }), makeParams());
	assert.equal(res.status, 400);
	const data = await res.json();
	assert.equal(data.error?.code, "VALIDATION_ERROR");
	assert.equal(spyCalls.prismaUpdate.length, 0);
});

test("PATCH /api/conversations/[id] enforces ownership and returns 404 for non-owned conversation", async () => {
	resetSpies();
	mockSessionUser = { id: ATTACKER_USER_ID };
	const res = await PATCH(makeJsonRequest({ pinned: true }), makeParams());
	assert.equal(res.status, 404);
	assert.equal(spyCalls.getConversationOrThrow.length, 1);
	assert.equal(spyCalls.getConversationOrThrow[0]?.userId, ATTACKER_USER_ID);
	assert.equal(spyCalls.prismaUpdate.length, 0);
});

test("PATCH /api/conversations/[id] with { pinned: true } updates pinnedAt to a Date", async () => {
	resetSpies();
	mockSessionUser = { id: OWNER_USER_ID };
	const res = await PATCH(makeJsonRequest({ pinned: true }), makeParams());
	assert.equal(res.status, 200);
	assert.equal(spyCalls.prismaUpdate.length, 1);
	const updateArgs = spyCalls.prismaUpdate[0]!;
	assert.equal(updateArgs.where.id, CONVERSATION_ID);
	assert.ok(updateArgs.data.pinnedAt instanceof Date);
	assert.equal(updateArgs.data.archivedAt, undefined);
	const body = await res.json();
	assert.ok(body.conversation.pinnedAt);
});

test("PATCH /api/conversations/[id] with { pinned: false } updates pinnedAt to null", async () => {
	resetSpies();
	mockSessionUser = { id: OWNER_USER_ID };
	const res = await PATCH(makeJsonRequest({ pinned: false }), makeParams());
	assert.equal(res.status, 200);
	assert.equal(spyCalls.prismaUpdate.length, 1);
	const updateArgs = spyCalls.prismaUpdate[0]!;
	assert.equal(updateArgs.data.pinnedAt, null);
	assert.equal(updateArgs.data.archivedAt, undefined);
	const body = await res.json();
	assert.equal(body.conversation.pinnedAt, null);
});

test("PATCH /api/conversations/[id] preserves title-only update behavior", async () => {
	resetSpies();
	mockSessionUser = { id: OWNER_USER_ID };
	const res = await PATCH(makeJsonRequest({ title: "Updated Research Title" }), makeParams());
	assert.equal(res.status, 200);
	assert.equal(spyCalls.prismaUpdate.length, 1);
	const updateArgs = spyCalls.prismaUpdate[0]!;
	assert.equal(updateArgs.data.title, "Updated Research Title");
	assert.equal(updateArgs.data.pinnedAt, undefined);
	assert.equal(updateArgs.data.archivedAt, undefined);
});

test("PATCH /api/conversations/[id] preserves archived-only update behavior", async () => {
	resetSpies();
	mockSessionUser = { id: OWNER_USER_ID };
	const res = await PATCH(makeJsonRequest({ archived: true }), makeParams());
	assert.equal(res.status, 200);
	assert.equal(spyCalls.prismaUpdate.length, 1);
	const updateArgs = spyCalls.prismaUpdate[0]!;
	assert.ok(updateArgs.data.archivedAt instanceof Date);
	assert.equal(updateArgs.data.pinnedAt, undefined);
});

test("ConversationSummary domain interface includes pinnedAt: Date | null", () => {
	const core = readWebFile("lib/conversation-memory-core.ts");
	assert.match(core, /export interface ConversationSummary\s*{[\s\S]*?readonly pinnedAt:\s*Date\s*\|\s*null;/);
});

test("listConversations selects pinnedAt and orders by lastMessageAt desc", () => {
	const core = readWebFile("lib/conversation-memory-core.ts");
	const section = functionSection(core, "listConversations");

	assert.match(
		section,
		/orderBy:\s*{\s*lastMessageAt:\s*"desc"\s*}/,
	);
	assert.match(
		section,
		/pinnedAt:\s*true/,
	);
});

test("createConversation selects pinnedAt", () => {
	const core = readWebFile("lib/conversation-memory-core.ts");
	const section = functionSection(core, "createConversation");

	assert.match(
		section,
		/pinnedAt:\s*true/,
	);
});

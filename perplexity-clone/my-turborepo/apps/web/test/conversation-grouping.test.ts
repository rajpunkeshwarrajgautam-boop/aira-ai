import assert from "node:assert/strict";
import test from "node:test";
import {
	partitionConversations,
	type ConversationGroupingItem,
} from "../lib/conversation-grouping";

const REF_DATE = new Date(2026, 8, 26, 12, 0, 0, 0);

function recentIds(result: ReturnType<typeof partitionConversations>): string[] {
	return result.recentGroups.flatMap((group) => group.items.map((item) => item.id));
}

test("only non-null pinnedAt entries enter Pinned and are ordered pinnedAt DESC", () => {
	const items: ConversationGroupingItem[] = [
		{ id: "c1", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt: new Date(2026, 8, 20, 10, 0) },
		{ id: "c2", lastMessageAt: new Date(2026, 8, 26, 11, 0), pinnedAt: null },
		{ id: "c3", lastMessageAt: new Date(2026, 8, 26, 8, 0), pinnedAt: new Date(2026, 8, 25, 10, 0) },
	];

	const result = partitionConversations(items, REF_DATE);
	assert.deepEqual(result.pinned.map((item) => item.id), ["c3", "c1"]);
	assert.ok(!result.pinned.some((item) => item.id === "c2"));
});

test("Pinned ordering uses deterministic id tie-breaking", () => {
	const pinnedAt = new Date(2026, 8, 25, 10, 0);
	const items: ConversationGroupingItem[] = [
		{ id: "z-conv", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt },
		{ id: "a-conv", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt },
	];

	const result = partitionConversations(items, REF_DATE);
	assert.deepEqual(result.pinned.map((item) => item.id), ["a-conv", "z-conv"]);
});

test("Pinned conversations are excluded from all Recent groups", () => {
	const items: ConversationGroupingItem[] = [
		{ id: "p1", lastMessageAt: new Date(2026, 8, 26, 11, 0), pinnedAt: new Date(2026, 8, 26, 11, 30) },
		{ id: "u1", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt: null },
	];

	const result = partitionConversations(items, REF_DATE);
	const ids = recentIds(result);
	assert.deepEqual(result.pinned.map((item) => item.id), ["p1"]);
	assert.ok(!ids.includes("p1"));
	assert.ok(ids.includes("u1"));
});

test("Recent conversations are ordered lastMessageAt DESC", () => {
	const items: ConversationGroupingItem[] = [
		{ id: "c1", lastMessageAt: new Date(2026, 8, 26, 8, 0) },
		{ id: "c2", lastMessageAt: new Date(2026, 8, 26, 11, 0) },
		{ id: "c3", lastMessageAt: new Date(2026, 8, 26, 9, 30) },
	];

	const result = partitionConversations(items, REF_DATE);
	const today = result.recentGroups.find((group) => group.key === "today");
	assert.ok(today);
	assert.deepEqual(today.items.map((item) => item.id), ["c2", "c3", "c1"]);
});

test("Recent ordering uses deterministic id tie-breaking", () => {
	const sameTime = new Date(2026, 8, 26, 9, 0);
	const items: ConversationGroupingItem[] = [
		{ id: "x-conv", lastMessageAt: sameTime },
		{ id: "b-conv", lastMessageAt: sameTime },
	];

	const result = partitionConversations(items, REF_DATE);
	const today = result.recentGroups.find((group) => group.key === "today");
	assert.ok(today);
	assert.deepEqual(today.items.map((item) => item.id), ["b-conv", "x-conv"]);
});

test("groups Recent into Today, Yesterday, Previous 7 Days, and Older", () => {
	const items: ConversationGroupingItem[] = [
		{ id: "today", lastMessageAt: new Date(2026, 8, 26, 10, 0) },
		{ id: "yesterday", lastMessageAt: new Date(2026, 8, 25, 23, 59) },
		{ id: "previous-1", lastMessageAt: new Date(2026, 8, 24, 15, 0) },
		{ id: "previous-2", lastMessageAt: new Date(2026, 8, 19, 0, 1) },
		{ id: "older", lastMessageAt: new Date(2026, 8, 18, 23, 59) },
	];

	const result = partitionConversations(items, REF_DATE);
	assert.deepEqual(
		result.recentGroups.map((group) => [group.key, group.items.map((item) => item.id)]),
		[
			["today", ["today"]],
			["yesterday", ["yesterday"]],
			["previous-7-days", ["previous-1", "previous-2"]],
			["older", ["older"]],
		],
	);
});

test("respects exact local calendar-day boundaries", () => {
	const startToday = new Date(2026, 8, 26, 0, 0, 0, 0);
	const startYesterday = new Date(2026, 8, 25, 0, 0, 0, 0);
	const start7DaysAgo = new Date(2026, 8, 19, 0, 0, 0, 0);
	const items: ConversationGroupingItem[] = [
		{ id: "today-start", lastMessageAt: startToday },
		{ id: "yesterday-end", lastMessageAt: new Date(startToday.getTime() - 1) },
		{ id: "yesterday-start", lastMessageAt: startYesterday },
		{ id: "previous-end", lastMessageAt: new Date(startYesterday.getTime() - 1) },
		{ id: "previous-start", lastMessageAt: start7DaysAgo },
		{ id: "older-end", lastMessageAt: new Date(start7DaysAgo.getTime() - 1) },
	];

	const result = partitionConversations(items, REF_DATE);
	assert.deepEqual(result.recentGroups.find((g) => g.key === "today")?.items.map((i) => i.id), ["today-start"]);
	assert.deepEqual(result.recentGroups.find((g) => g.key === "yesterday")?.items.map((i) => i.id), ["yesterday-end", "yesterday-start"]);
	assert.deepEqual(result.recentGroups.find((g) => g.key === "previous-7-days")?.items.map((i) => i.id), ["previous-end", "previous-start"]);
	assert.deepEqual(result.recentGroups.find((g) => g.key === "older")?.items.map((i) => i.id), ["older-end"]);
});

test("omits empty Recent date groups", () => {
	const result = partitionConversations([{ id: "old", lastMessageAt: new Date(2026, 0, 1) }], REF_DATE);
	assert.deepEqual(result.recentGroups.map((group) => group.key), ["older"]);
});

test("normal unique conversation IDs never appear in both Pinned and Recent", () => {
	const items: ConversationGroupingItem[] = [
		{ id: "pinned", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt: new Date(2026, 8, 26, 11, 0) },
		{ id: "recent-a", lastMessageAt: new Date(2026, 8, 26, 9, 0) },
		{ id: "recent-b", lastMessageAt: new Date(2026, 8, 25, 9, 0) },
	];

	const result = partitionConversations(items, REF_DATE);
	const pinnedIds = new Set(result.pinned.map((item) => item.id));
	const overlap = recentIds(result).filter((id) => pinnedIds.has(id));
	assert.deepEqual(overlap, []);
});

test("does not mutate the input array or input items", () => {
	const itemA = Object.freeze<ConversationGroupingItem>({ id: "b", lastMessageAt: new Date(2026, 8, 26, 8, 0) });
	const itemB = Object.freeze<ConversationGroupingItem>({ id: "a", lastMessageAt: new Date(2026, 8, 26, 10, 0) });
	const input = Object.freeze([itemA, itemB] as const);

	const result = partitionConversations(input, REF_DATE);
	assert.equal(input[0], itemA);
	assert.equal(input[1], itemB);
	assert.deepEqual(result.recentGroups[0]?.items.map((item) => item.id), ["a", "b"]);
});

test("does not mutate a supplied reference Date", () => {
	const referenceDate = new Date(2026, 8, 26, 12, 0, 0, 0);
	const originalMs = referenceDate.getTime();
	partitionConversations([{ id: "c1", lastMessageAt: new Date(2026, 8, 26, 10, 0) }], referenceDate);
	assert.equal(referenceDate.getTime(), originalMs);
});

test("pin transition removes a conversation from Recent and adds it to Pinned without changing lastMessageAt", () => {
	const lastMessageAt = new Date(2026, 8, 26, 10, 0);
	const initial: ConversationGroupingItem = { id: "c1", lastMessageAt, pinnedAt: null };
	const before = partitionConversations([initial], REF_DATE);
	assert.deepEqual(recentIds(before), ["c1"]);
	assert.deepEqual(before.pinned, []);

	const updated: ConversationGroupingItem = { ...initial, pinnedAt: new Date(2026, 8, 26, 12, 30) };
	const after = partitionConversations([updated], REF_DATE);
	assert.deepEqual(after.pinned.map((item) => item.id), ["c1"]);
	assert.deepEqual(recentIds(after), []);
	assert.equal(after.pinned[0]?.lastMessageAt, lastMessageAt);
});

test("unpin transition returns a conversation to its correct Recent group without changing lastMessageAt", () => {
	const lastMessageAt = new Date(2026, 8, 25, 10, 0);
	const initial: ConversationGroupingItem = {
		id: "c1",
		lastMessageAt,
		pinnedAt: new Date(2026, 8, 26, 12, 30),
	};
	const before = partitionConversations([initial], REF_DATE);
	assert.deepEqual(before.pinned.map((item) => item.id), ["c1"]);

	const updated: ConversationGroupingItem = { ...initial, pinnedAt: null };
	const after = partitionConversations([updated], REF_DATE);
	assert.deepEqual(after.pinned, []);
	const yesterday = after.recentGroups.find((group) => group.key === "yesterday");
	assert.deepEqual(yesterday?.items.map((item) => item.id), ["c1"]);
	assert.equal(yesterday?.items[0]?.lastMessageAt, lastMessageAt);
});

test("rejects an invalid reference Date", () => {
	assert.throws(
		() => partitionConversations([{ id: "c1", lastMessageAt: new Date(2026, 8, 26, 10, 0) }], new Date(Number.NaN)),
		(error: unknown) => error instanceof RangeError && /referenceDate/.test(error.message),
	);
});

test("rejects invalid lastMessageAt rather than silently regrouping it", () => {
	assert.throws(
		() => partitionConversations([{ id: "c1", lastMessageAt: "not-a-real-date" }], REF_DATE),
		(error: unknown) => error instanceof TypeError && /lastMessageAt/.test(error.message),
	);
});

test("non-null invalid pinnedAt is not silently treated as unpinned", () => {
	assert.throws(
		() => partitionConversations([{ id: "c1", lastMessageAt: new Date(2026, 8, 26, 10, 0), pinnedAt: "not-a-real-date" }], REF_DATE),
		(error: unknown) => error instanceof TypeError && /pinnedAt/.test(error.message),
	);
});

import assert from "node:assert/strict";
import test, { mock } from "node:test";

type Write = { userId: string; content: string; pinned: boolean };
const writes: Write[] = [];
let save: (args: Write) => Promise<{ content: string }> = async (args) => ({ content: args.content });
mock.module("../lib/persistent-memory", { exports: {
	createManualMemory: async (args: Write) => { writes.push(args); return save(args); },
} });
const { createMemoryCommandAnswer } = await import("../lib/memory-command-answer");

test("direct memory acknowledgement waits for the confirmed user-owned write", async () => {
	writes.length = 0;
	let confirm!: (value: { content: string }) => void;
	save = async () => new Promise((resolve) => { confirm = resolve; });
	let acknowledged = false;
	const pending = createMemoryCommandAnswer({ userId: "owner", query: "Remember that my review code is PINE-8842." })
		.then((result) => { acknowledged = true; return result; });
	await Promise.resolve();
	assert.equal(acknowledged, false);
	assert.deepEqual(writes, [{ userId: "owner", content: "my review code is PINE-8842.", pinned: true }]);
	confirm({ content: "my review code is PINE-8842" });
	const result = await pending;
	let text = "";
	for await (const part of result!.textStream) text += part;
	assert.equal(text, "Saved to memory: my review code is PINE-8842");
	assert.deepEqual(result!.sources, []);
});

test("direct corrections acknowledge the updated subject and returned value", async () => {
	writes.length = 0;
	save = async (args) => ({ content: args.content });
	for (const query of ["Correction: remember that my review code is NEW-4492.", "Please update what you remember about my review code to NEW-4492 instead."]) {
		const result = await createMemoryCommandAnswer({ userId: "owner", query });
		let text = "";
		for await (const part of result!.textStream) text += part;
		assert.match(text, /^Saved to memory: my review code is NEW-4492\.?$/);
	}
	assert.equal(writes.length, 2);
});

test("private requests, recall questions, and indirect instructions do not use direct writes", async () => {
	writes.length = 0;
	for (const query of ["Private session. No memory. Remember that my review code is PRIVATE-44.", "Remember that my code is PRIVATE-44, but do not store it.", "Do you remember that my review code is PINE-8842?", "From now on, give concise explanations."]) {
		assert.equal(await createMemoryCommandAnswer({ userId: "owner", query }), null);
	}
	assert.deepEqual(writes, []);
});

test("rejected or unavailable persistence never returns a successful acknowledgement", async () => {
	save = async () => { throw new Error("Memory rejected"); };
	await assert.rejects(createMemoryCommandAnswer({ userId: "owner", query: "Remember that my review code is PINE-8842." }), /Memory rejected/);
});

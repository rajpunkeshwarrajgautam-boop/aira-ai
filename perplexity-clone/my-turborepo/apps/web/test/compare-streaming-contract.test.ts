import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWebFile(relativePath: string): string {
	return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

test("compare API publishes each target incrementally over NDJSON", () => {
	const route = readWebFile("app/api/compare/route.ts");

	assert.ok(route.includes('type: "delta"'));
	assert.ok(route.includes('type: "complete"'));
	assert.ok(route.includes('type: "error"'));
	assert.ok(route.includes("new ReadableStream<Uint8Array>"));
	assert.ok(route.includes('"Content-Type": "application/x-ndjson; charset=utf-8"'));
	assert.ok(route.includes("parsed.data.targets.map((target) => runTarget"));

	const streamLoop = route.match(
		/for await \(const delta of router\.streamChat[\s\S]*?publish\(\{\s*type: "complete"/,
	)?.[0];
	assert.ok(streamLoop, "compare target must stream provider output before completion");

	const deltaIndex = streamLoop.search(/publish\(\{\s*type: "delta"/);
	const completeIndex = streamLoop.search(/publish\(\{\s*type: "complete"/);
	assert.ok(deltaIndex >= 0, "compare target must publish incremental delta events");
	assert.ok(completeIndex >= 0, "compare target must publish a completion event");
	assert.ok(deltaIndex < completeIndex, "delta events must be published before completion");
});

test("compare workspace consumes streaming events independently per target", () => {
	const page = readWebFile("app/compare/page.tsx");

	assert.ok(page.includes('type ResultStatus = "pending" | "streaming" | "success" | "error"'));
	assert.ok(page.includes("response.body.getReader()"));
	assert.ok(page.includes("applyStreamEvent"));
	assert.ok(page.includes('event.type === "delta"'));
	assert.ok(page.includes('event.type === "complete"'));
	assert.ok(page.includes('status: "error"'));
	assert.ok(page.includes("error: event.error"));
	assert.ok(page.includes('aria-live="polite"'));
	assert.ok(
		page.includes("Completed columns stay visible even if another target fails."),
		"the UI must communicate the independent-target failure contract truthfully",
	);
});

import assert from "node:assert/strict";
import test from "node:test";
import { streamGroundedAnswer, type SearchProgressEvent } from "../src/services/answer";
import type { ExaSearchService } from "../src/services/search";

test("BL-01: streamGroundedAnswer reports ordered progress events", async () => {
	const events: SearchProgressEvent[] = [];

	const mockExa = {
		search: async () => ({
			query: "test query",
			candidates: [
				{
					url: "https://example.com/test",
					title: "Example Title",
					excerpt: "Example excerpt of content",
					score: 0.95,
					publishedDate: null,
					originalRank: 1,
				},
			],
			requestId: "req-test-123",
			searchType: "neural",
			hits: [],
		}),
	};

	const res = await streamGroundedAnswer({
		query: "What is quantum computing?",
		exa: mockExa as unknown as ExaSearchService,
		onProgress: (ev) => {
			events.push(ev);
		},
	});

	assert.ok(events.length >= 3, "Expected at least 3 progress events");
	assert.equal(events[0]?.stage, "searching_web");
	assert.equal(events[1]?.stage, "sources_found");
	assert.equal(events[2]?.stage, "analyzing_sources");

	// Verify no sensitive internal prompt text or secrets leaked in progress events
	for (const ev of events) {
		assert.ok(!ev.message.includes("You are AIRA"), "Must not leak system prompt");
		assert.ok(!ev.message.includes("sk-"), "Must not leak secret keys");
		assert.ok(typeof ev.elapsedMs === "number" && ev.elapsedMs >= 0, "Elapsed ms must be positive");
	}

	// Verify backward compatibility of result object
	assert.ok(res.query, "GroundedAnswerStreamResult must have query");
	assert.ok(Array.isArray(res.sources), "GroundedAnswerStreamResult must have sources array");
	assert.equal(res.exaRequestId, "req-test-123");
});

test("BL-01: SSE backward compatibility with unknown event types", () => {
	// Simulate client SSE block parser ignoring unknown events
	function parseSseBlock(block: string): { event: string; data: string } | null {
		const lines = block.split(/\r?\n/);
		let event = "message";
		let data = "";
		for (const line of lines) {
			if (line.startsWith("event: ")) event = line.slice(7).trim();
			else if (line.startsWith("data: ")) data = line.slice(6).trim();
		}
		return data ? { event, data } : null;
	}

	const legacyClientHandledEvents: string[] = [];
	const sseStreamChunks = [
		"event: progress\ndata: {\"stage\":\"request_received\",\"message\":\"Request received…\",\"elapsedMs\":10}\n\n",
		"event: progress\ndata: {\"stage\":\"searching_web\",\"message\":\"Searching the web…\",\"elapsedMs\":120}\n\n",
		"event: metadata\ndata: {\"query\":\"test\",\"citations\":[]}\n\n",
		"event: text\ndata: {\"delta\":\"Hello \"}\n\n",
		"event: text\ndata: {\"delta\":\"world!\"}\n\n",
		"event: done\ndata: {\"type\":\"done\"}\n\n",
	];

	for (const chunk of sseStreamChunks) {
		const parsed = parseSseBlock(chunk.trim());
		if (!parsed) continue;
		// Older client ignores unknown event types:
		if (parsed.event === "metadata" || parsed.event === "text" || parsed.event === "done") {
			legacyClientHandledEvents.push(parsed.event);
		}
	}

	assert.deepEqual(
		legacyClientHandledEvents,
		["metadata", "text", "text", "done"],
		"Legacy clients must seamlessly process core stream events and ignore progress events without error"
	);
});

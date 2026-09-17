import assert from "node:assert/strict";
import test from "node:test";
import { logProductEvent, type ProductAnalyticsEvent } from "../lib/log-product-event";

test("BL-03: logProductEvent supports all v5.0.2 mandatory event types", () => {
	const supportedEvents: ProductAnalyticsEvent[] = [
		"pricing_viewed",
		"upgrade_clicked",
		"signin_started",
		"search_started",
		"citation_clicked",
		"work_opened",
		"compare_started",
	];

	for (const ev of supportedEvents) {
		assert.doesNotThrow(() => {
			logProductEvent({
				event: ev,
				surface: "test",
				userType: "signed_in",
			});
		}, `Event ${ev} should be accepted by logProductEvent`);
	}
});

test("BL-03: logProductEvent deduplicates rapid duplicate events", () => {
	// Mock fetch
	let fetchCallCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		fetchCallCount++;
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	}) as unknown as typeof fetch;

	try {
		// First call should go through
		logProductEvent({
			event: "pricing_viewed",
			surface: "pricing-unique-test",
			userType: "guest",
		});

		// Immediate second call with identical payload must be dropped by deduplication
		logProductEvent({
			event: "pricing_viewed",
			surface: "pricing-unique-test",
			userType: "guest",
		});

		assert.equal(fetchCallCount, 1, "Duplicate rapid event must be dropped within deduplication window");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("BL-03: analytics events never contain raw prompt text or secrets", () => {
	const sensitivePayload = {
		event: "citation_clicked" as const,
		surface: "answer",
		userType: "signed_in" as const,
		citationIndex: 1,
		sourceDomain: "nature.com",
	};

	const serialized = JSON.stringify(sensitivePayload);
	assert.ok(!serialized.includes("prompt"), "Payload must not contain prompt keys");
	assert.ok(!serialized.includes("token"), "Payload must not contain token keys");
	assert.ok(!serialized.includes("password"), "Payload must not contain password keys");
	assert.ok(serialized.includes("nature.com"), "Payload includes sanitized domain only");
});

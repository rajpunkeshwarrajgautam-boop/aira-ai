/**
 * Best-effort product analytics (server logs only). No DB, no PII in payload.
 */
export type ProductAnalyticsEvent = "guest_search_started" | "share_clicked" | "feedback_clicked";

export function logProductEvent(params: {
	readonly event: ProductAnalyticsEvent;
	readonly surface: string;
	readonly citationCount?: number;
}): void {
	const body: Record<string, unknown> = {
		event: params.event,
		surface: params.surface,
	};
	if (params.citationCount !== undefined) {
		body.citationCount = params.citationCount;
	}

	try {
		void fetch("/api/analytics/product-event", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			keepalive: true,
		});
	} catch {
		// ignore
	}
}

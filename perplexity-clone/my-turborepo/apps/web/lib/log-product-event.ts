/**
 * Best-effort product analytics (POST /api/analytics/product-event → server stdout).
 * No query text, answers, or secrets in payloads.
 */

export type ProductAnalyticsEvent =
	| "search_submitted"
	| "answer_stream_started"
	| "answer_completed"
	| "citation_clicked"
	| "source_opened"
	| "example_query_clicked"
	| "sign_in_clicked"
	| "guest_quota_reached"
	| "deep_research_clicked"
	| "share_clicked"
	/** @deprecated Prefer search_submitted */
	| "guest_search_started"
	| "feedback_clicked";

export type ProductAnalyticsUserType = "guest" | "signed_in";

export type ProductAnalyticsSurface =
	| "home"
	| "search"
	| "answer"
	| "citation"
	| "source_cards"
	| "auth"
	| "deep_research"
	| "share"
	| "share_bar"
	| string;

export type ProductAnalyticsPayload = {
	readonly event: ProductAnalyticsEvent;
	readonly userType?: ProductAnalyticsUserType;
	readonly surface?: ProductAnalyticsSurface;
	readonly queryLength?: number;
	readonly sourceCount?: number;
	/** @deprecated Prefer sourceCount; kept for backward compatibility */
	readonly citationCount?: number;
	readonly citationIndex?: number;
	readonly sourceDomain?: string;
	readonly conversationId?: string;
	readonly messageId?: string;
	readonly errorCode?: string;
};

export function logProductEvent(params: ProductAnalyticsPayload): void {
	try {
		const body: Record<string, unknown> = {
			event: params.event,
		};
		if (params.userType !== undefined) body.userType = params.userType;
		if (params.surface !== undefined) body.surface = params.surface;
		if (params.queryLength !== undefined) body.queryLength = params.queryLength;
		if (params.sourceCount !== undefined) body.sourceCount = params.sourceCount;
		if (params.citationCount !== undefined) body.citationCount = params.citationCount;
		if (params.citationIndex !== undefined) body.citationIndex = params.citationIndex;
		if (params.sourceDomain !== undefined) body.sourceDomain = params.sourceDomain;
		if (params.conversationId !== undefined) body.conversationId = params.conversationId;
		if (params.messageId !== undefined) body.messageId = params.messageId;
		if (params.errorCode !== undefined) body.errorCode = params.errorCode;

		void fetch("/api/analytics/product-event", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			keepalive: true,
		}).catch(() => {
			// ignore
		});
	} catch {
		// ignore
	}
}

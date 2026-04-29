import { z } from "zod";

/**
 * Keep these as explicit string unions (not Prisma enums) so request/response
 * payloads stay stable and zod validation can be strict.
 */
export const AnalyticsEventTypeSchema = z.enum([
	"VISITOR_LANDED",
	"SIGNUP_COMPLETED",
	"SEARCH_STANDARD",
	"SEARCH_DEEP",
	"SHARE_CREATED",
	"UPGRADE_CHECKOUT_STARTED",
	"UPGRADE_COMPLETED",
	"QUOTA_EXCEEDED",
	"PLAN_REQUIRED",
	"SEARCH_ERROR",
	"ERROR_EVENT",
]);

export type AnalyticsEventType = z.infer<typeof AnalyticsEventTypeSchema>;

export const AnalyticsMetadataSchema = z.record(z.string(), z.unknown()).optional();

export interface TrackAnalyticsEventInput {
	readonly type: AnalyticsEventType;
	readonly userId?: string;
	readonly anonymousId?: string;
	readonly plan?: unknown;
	readonly metadata?: Readonly<Record<string, unknown>>;
}


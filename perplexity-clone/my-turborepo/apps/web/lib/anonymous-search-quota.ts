import { AnalyticsEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

function startOfUtcDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export class AnonymousQuotaError extends Error {
	readonly status = 429;
	readonly code = "ANONYMOUS_QUOTA_EXCEEDED";

	constructor() {
		super("Daily limit reached for searches without an account. Sign in to continue.");
		this.name = "AnonymousQuotaError";
	}
}

/**
 * Enforces a per-day cap on completed searches for unsigned visitors (tracked via analytics events).
 */
export async function assertAnonymousSearchAllowed(anonymousId: string): Promise<void> {
	const raw = process.env.ANONYMOUS_DAILY_SEARCH_LIMIT ?? "10";
	const limit = Math.max(1, Math.min(500, parseInt(raw, 10) || 10));
	const eventDay = startOfUtcDay(new Date());

	const count = await prisma.analyticsEvent.count({
		where: {
			anonymousId,
			eventDay,
			userId: null,
			type: { in: [AnalyticsEventType.SEARCH_STANDARD, AnalyticsEventType.SEARCH_DEEP] },
		},
	});

	if (count >= limit) {
		throw new AnonymousQuotaError();
	}
}

import { prisma } from "@/lib/prisma";
import type { AnalyticsEventType } from "./analytics-types";

type DayKey = string; // YYYY-MM-DD

function dayKeyFromUtcDate(d: Date): DayKey {
	return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endExclusiveUtcDay(d: Date): Date {
	// day after start-of-day
	const start = startOfUtcDay(d);
	return new Date(start.getTime() + 86_400_000);
}

const FUNNEL_TYPES = [
	"VISITOR_LANDED",
	"SIGNUP_COMPLETED",
	"SEARCH_STANDARD",
	"SEARCH_DEEP",
	"SHARE_CREATED",
	"UPGRADE_COMPLETED",
] as const;

type FunnelType = (typeof FUNNEL_TYPES)[number];

const RATE_LIMIT_TYPES = ["QUOTA_EXCEEDED", "PLAN_REQUIRED"] as const;
type RateLimitType = (typeof RATE_LIMIT_TYPES)[number];

export interface DailyAnalyticsPoint {
	readonly day: DayKey;
	readonly visitors: number;
	readonly signups: number;
	readonly searchesStandard: number;
	readonly searchesDeep: number;
	readonly shares: number;
	readonly upgrades: number;
	readonly quotaExceeded: number;
	readonly planRequired: number;
}

export async function getDailyAnalyticsPoints(params: {
	readonly days: number;
}): Promise<readonly DailyAnalyticsPoint[]> {
	const days = Math.max(1, Math.min(params.days, 90));
	const now = new Date();
	const start = new Date(now.getTime() - (days - 1) * 86_400_000);

	const startDay = startOfUtcDay(start);
	const endDayExclusive = endExclusiveUtcDay(now);

	const dayKeys: DayKey[] = [];
	for (let i = 0; i < days; i++) {
		dayKeys.push(dayKeyFromUtcDate(new Date(startDay.getTime() + i * 86_400_000)));
	}

	const visitorIdSets = new Map<DayKey, Set<string>>();
	const signupUserIdSets = new Map<DayKey, Set<string>>();

	for (const dk of dayKeys) {
		visitorIdSets.set(dk, new Set());
		signupUserIdSets.set(dk, new Set());
	}

	const searchesStandardCounts = new Map<DayKey, number>();
	const searchesDeepCounts = new Map<DayKey, number>();
	const sharesCounts = new Map<DayKey, number>();
	const upgradesCounts = new Map<DayKey, number>();
	const quotaExceededCounts = new Map<DayKey, number>();
	const planRequiredCounts = new Map<DayKey, number>();

	for (const dk of dayKeys) {
		searchesStandardCounts.set(dk, 0);
		searchesDeepCounts.set(dk, 0);
		sharesCounts.set(dk, 0);
		upgradesCounts.set(dk, 0);
		quotaExceededCounts.set(dk, 0);
		planRequiredCounts.set(dk, 0);
	}

	const events = await prisma.analyticsEvent.findMany({
		where: {
			eventDay: { gte: startDay, lt: endDayExclusive },
			type: { in: [...FUNNEL_TYPES, ...RATE_LIMIT_TYPES] as unknown as AnalyticsEventType[] },
		},
		select: {
			eventDay: true,
			type: true,
			anonymousId: true,
			userId: true,
		},
	});

	for (const ev of events) {
		const dk = dayKeyFromUtcDate(ev.eventDay);
		if (!dk) continue;

		switch (ev.type as FunnelType | RateLimitType) {
			case "VISITOR_LANDED": {
				const set = visitorIdSets.get(dk);
				if (set && ev.anonymousId) set.add(ev.anonymousId);
				break;
			}
			case "SIGNUP_COMPLETED": {
				const set = signupUserIdSets.get(dk);
				if (set && ev.userId) set.add(ev.userId);
				break;
			}
			case "SEARCH_STANDARD":
				searchesStandardCounts.set(dk, (searchesStandardCounts.get(dk) ?? 0) + 1);
				break;
			case "SEARCH_DEEP":
				searchesDeepCounts.set(dk, (searchesDeepCounts.get(dk) ?? 0) + 1);
				break;
			case "SHARE_CREATED":
				sharesCounts.set(dk, (sharesCounts.get(dk) ?? 0) + 1);
				break;
			case "UPGRADE_COMPLETED":
				upgradesCounts.set(dk, (upgradesCounts.get(dk) ?? 0) + 1);
				break;
			case "QUOTA_EXCEEDED":
				quotaExceededCounts.set(dk, (quotaExceededCounts.get(dk) ?? 0) + 1);
				break;
			case "PLAN_REQUIRED":
				planRequiredCounts.set(dk, (planRequiredCounts.get(dk) ?? 0) + 1);
				break;
		}
	}

	return dayKeys.map((day) => ({
		day,
		visitors: visitorIdSets.get(day)?.size ?? 0,
		signups: signupUserIdSets.get(day)?.size ?? 0,
		searchesStandard: searchesStandardCounts.get(day) ?? 0,
		searchesDeep: searchesDeepCounts.get(day) ?? 0,
		shares: sharesCounts.get(day) ?? 0,
		upgrades: upgradesCounts.get(day) ?? 0,
		quotaExceeded: quotaExceededCounts.get(day) ?? 0,
		planRequired: planRequiredCounts.get(day) ?? 0,
	}));
}

export interface FunnelAnalyticsResult {
	readonly from: DayKey;
	readonly to: DayKey;
	readonly visitors: number;
	readonly signups: number;
	readonly searches: number;
	readonly shares: number;
	readonly upgrades: number;
	readonly visitorToSignupRate: number;
	readonly signupToSearchRate: number;
	readonly searchToShareRate: number;
	readonly shareToUpgradeRate: number;
}

export async function getConversionFunnel(params: { readonly from: Date; readonly to: Date }): Promise<FunnelAnalyticsResult> {
	const start = startOfUtcDay(params.from);
	const endExclusive = endExclusiveUtcDay(params.to);

	const events = await prisma.analyticsEvent.findMany({
		where: {
			eventDay: { gte: start, lt: endExclusive },
			type: { in: [...FUNNEL_TYPES] as unknown as AnalyticsEventType[] },
		},
		select: {
			type: true,
			anonymousId: true,
			userId: true,
		},
	});

	const visitorAnonIds = new Set<string>();
	const signupAnonIds = new Set<string>();
	const searchAnonIds = new Set<string>();
	const shareAnonIds = new Set<string>();
	const upgradeAnonIds = new Set<string>();

	for (const ev of events) {
		switch (ev.type as FunnelType) {
			case "VISITOR_LANDED":
				if (ev.anonymousId) visitorAnonIds.add(ev.anonymousId);
				break;
			case "SIGNUP_COMPLETED":
				if (ev.anonymousId) signupAnonIds.add(ev.anonymousId);
				break;
			case "SEARCH_STANDARD":
			case "SEARCH_DEEP":
				if (ev.anonymousId) searchAnonIds.add(ev.anonymousId);
				break;
			case "SHARE_CREATED":
				if (ev.anonymousId) shareAnonIds.add(ev.anonymousId);
				break;
			case "UPGRADE_COMPLETED":
				if (ev.anonymousId) upgradeAnonIds.add(ev.anonymousId);
				break;
		}
	}

	const visitors = visitorAnonIds.size;
	const signups = signupAnonIds.size;
	const searches = searchAnonIds.size;
	const shares = shareAnonIds.size;
	const upgrades = upgradeAnonIds.size;

	const visitorToSignupRate = visitors > 0 ? signups / visitors : 0;
	const signupToSearchRate = signups > 0 ? searches / signups : 0;
	const searchToShareRate = searches > 0 ? shares / searches : 0;
	const shareToUpgradeRate = shares > 0 ? upgrades / shares : 0;

	return {
		from: dayKeyFromUtcDate(start),
		to: dayKeyFromUtcDate(endExclusive),
		visitors,
		signups,
		searches,
		shares,
		upgrades,
		visitorToSignupRate,
		signupToSearchRate,
		searchToShareRate,
		shareToUpgradeRate,
	};
}

export interface RateLimitAnalyticsPoint {
	readonly day: DayKey;
	readonly quotaExceeded: number;
	readonly planRequired: number;
}


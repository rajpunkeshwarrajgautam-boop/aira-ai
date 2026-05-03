import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";
import {
	AnalyticsEventType as AnalyticsEventTypePrisma,
	BillingPlan,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

import type { AnalyticsEventType, TrackAnalyticsEventInput } from "./analytics-types";
import { AnalyticsEventTypeSchema } from "./analytics-types";

const ANON_ID_DEFAULT_RESOLVE = true;

function startOfUtcDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function safeMetadata(input: unknown): Prisma.InputJsonValue | undefined {
	if (!input) return undefined;
	// Keep analytics metadata JSON-serializable; avoid persisting request bodies directly.
	if (typeof input !== "object") return undefined;
	if (Array.isArray(input)) return undefined;
	try {
		return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
	} catch {
		return undefined;
	}
}

async function resolveAnonymousIdForUser(userId: string): Promise<string | undefined> {
	const row = await prisma.analyticsSignupState.findUnique({
		where: { userId },
		select: { anonymousId: true },
	});
	return row?.anonymousId ?? undefined;
}

export async function ensureVisitorLandedTracked(params: {
	readonly anonymousId: string;
}): Promise<{ readonly created: boolean }> {
	const now = new Date();
	const existing = await prisma.analyticsVisitorState.findUnique({
		where: { anonymousId: params.anonymousId },
		select: { anonymousId: true },
	});

	if (existing) {
		await prisma.analyticsVisitorState.update({
			where: { anonymousId: params.anonymousId },
			data: { lastSeenAt: now },
		});
		return { created: false };
	}

	await prisma.analyticsVisitorState.create({
		data: {
			anonymousId: params.anonymousId,
			firstLandedAt: now,
			lastSeenAt: now,
		},
	});

	await trackAnalyticsEventInternal({
		type: "VISITOR_LANDED",
		anonymousId: params.anonymousId,
	});

	return { created: true };
}

export async function ensureSignupCompletedTracked(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan | null;
}): Promise<void> {
	const now = new Date();

	const existing = await prisma.analyticsSignupState.findUnique({
		where: { userId: params.userId },
		select: { userId: true, anonymousId: true },
	});

	if (existing) {
		// Keep anonymousId if it was previously unknown.
		if (!existing.anonymousId && params.anonymousId) {
			await prisma.analyticsSignupState.update({
				where: { userId: params.userId },
				data: { anonymousId: params.anonymousId, signupAt: now },
			});
		}
		return;
	}

	await prisma.analyticsSignupState.create({
		data: {
			userId: params.userId,
			anonymousId: params.anonymousId ?? undefined,
			signupAt: now,
		},
	});

	await trackAnalyticsEventInternal({
		type: "SIGNUP_COMPLETED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan ?? undefined,
		metadata: { signupAt: now.toISOString() },
	});
}

async function trackAnalyticsEventInternal(args: {
	readonly type: AnalyticsEventType;
	readonly userId?: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
	readonly metadata?: Readonly<Record<string, unknown>>;
}): Promise<void> {
	// Best-effort: never fail the caller.
	try {
		const parsedType = AnalyticsEventTypeSchema.safeParse(args.type);
		if (!parsedType.success) return;

		let anonymousId = args.anonymousId;
		const userId = args.userId;
		if (!anonymousId && userId && ANON_ID_DEFAULT_RESOLVE) {
			anonymousId = await resolveAnonymousIdForUser(userId);
		}

		const now = new Date();
		const eventDay = startOfUtcDay(now);

		await prisma.analyticsEvent.create({
			data: {
				type: parsedType.data as AnalyticsEventTypePrisma,
				eventDay,
				anonymousId: anonymousId ?? undefined,
				userId: userId ?? undefined,
				plan: args.plan ?? undefined,
				metadata: args.metadata ? safeMetadata(args.metadata) : undefined,
			},
		});
	} catch {
		// swallow errors by design
	}
}

export async function trackAnalyticsEvent(args: TrackAnalyticsEventInput): Promise<void> {
	await trackAnalyticsEventInternal({
		type: args.type,
		userId: args.userId,
		anonymousId: args.anonymousId,
		plan: args.plan as BillingPlan | undefined,
		metadata: (args.metadata as Readonly<Record<string, unknown>> | undefined) ?? undefined,
	});
}

export async function trackSearchEvent(params: {
	readonly userId?: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
	readonly mode: "standard" | "deep";
	readonly citationCount: number;
	readonly exaSearchType?: string;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: params.mode === "deep" ? "SEARCH_DEEP" : "SEARCH_STANDARD",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan,
		metadata: {
			citationCount: params.citationCount,
			exaSearchType: params.exaSearchType ?? null,
			mode: params.mode,
		},
	});
}

export async function trackShareCreatedEvent(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: "SHARE_CREATED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan,
	});
}

export async function trackUpgradeCheckoutStartedEvent(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
	readonly teamSeats?: number;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: "UPGRADE_CHECKOUT_STARTED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan,
		metadata: {
			teamSeats: params.teamSeats ?? null,
		},
	});
}

export async function trackUpgradeCompletedEvent(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: "UPGRADE_COMPLETED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan,
	});
}

export async function trackErrorEvent(params: {
	readonly userId?: string;
	readonly anonymousId?: string;
	readonly code?: string;
	readonly message?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}): Promise<void> {
	const correlationId = crypto.randomBytes(6).toString("base64url");
	await trackAnalyticsEvent({
		type: "ERROR_EVENT",
		userId: params.userId,
		anonymousId: params.anonymousId,
		metadata: {
			correlationId,
			code: params.code ?? null,
			message: params.message ?? null,
			...(params.metadata ?? {}),
		},
	});
}

export async function trackSearchErrorEvent(params: {
	readonly userId?: string;
	readonly anonymousId?: string;
	readonly code?: string;
	readonly message?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}): Promise<void> {
	const correlationId = crypto.randomBytes(6).toString("base64url");
	await trackAnalyticsEvent({
		type: "SEARCH_ERROR",
		userId: params.userId,
		anonymousId: params.anonymousId,
		metadata: {
			correlationId,
			code: params.code ?? null,
			message: params.message ?? null,
			...(params.metadata ?? {}),
		},
	});
}

export async function trackQuotaExceededEvent(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly plan?: BillingPlan;
	readonly code?: string;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: "QUOTA_EXCEEDED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.plan,
		metadata: { code: params.code ?? null },
	});
}

export async function trackPlanRequiredEvent(params: {
	readonly userId: string;
	readonly anonymousId?: string;
	readonly requiredPlan: BillingPlan;
}): Promise<void> {
	await trackAnalyticsEvent({
		type: "PLAN_REQUIRED",
		userId: params.userId,
		anonymousId: params.anonymousId,
		plan: params.requiredPlan,
	});
}


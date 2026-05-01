import {
	BillingPlan,
	SubscriptionStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { effectiveMonthlySearchLimit, PLAN_LIMITS } from "./plans";

type DbClient = Pick<Prisma.TransactionClient, "user" | "usageRecord">;

export class PlanEnforcementError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function startOfUtcMonth(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export interface EffectiveEntitlements {
	readonly billingPlan: BillingPlan;
	readonly teamSeats: number;
	readonly monthlySearchLimit: number;
}

async function loadEntitlements(
	db: DbClient,
	userId: string,
): Promise<EffectiveEntitlements> {
	const user = await db.user.findUnique({
		where: { id: userId },
		include: { billingSubscription: true },
	});
	if (!user) {
		throw new PlanEnforcementError(401, "UNAUTHENTICATED", "User not found.");
	}

	const sub = user.billingSubscription;
	const paid =
		sub !== null &&
		(sub.status === SubscriptionStatus.ACTIVE ||
			sub.status === SubscriptionStatus.TRIALING);

	const billingPlan = paid ? sub.plan : BillingPlan.FREE;
	const teamSeats =
		billingPlan === BillingPlan.TEAM ? (sub?.teamSeats ?? 1) : 1;

	return {
		billingPlan,
		teamSeats,
		monthlySearchLimit: effectiveMonthlySearchLimit(billingPlan, teamSeats),
	};
}

export async function getEffectiveEntitlements(
	userId: string,
): Promise<EffectiveEntitlements> {
	return loadEntitlements(prisma, userId);
}

/**
 * Enforces monthly search quota atomically. Call once per successful search request.
 */
export async function consumeSearchQuota(userId: string): Promise<EffectiveEntitlements> {
	const periodStart = startOfUtcMonth(new Date());

	return prisma.$transaction(async (tx) => {
		const entitlements = await loadEntitlements(tx, userId);
		const limit = entitlements.monthlySearchLimit;

		const row = await tx.usageRecord.upsert({
			where: {
				userId_periodStart: { userId, periodStart },
			},
			create: { userId, periodStart, searches: 0 },
			update: {},
		});

		if (row.searches >= limit) {
			throw new PlanEnforcementError(
				402,
				"QUOTA_EXCEEDED",
				"Monthly search quota exceeded for your plan.",
			);
		}

		await tx.usageRecord.update({
			where: { userId_periodStart: { userId, periodStart } },
			data: { searches: { increment: 1 } },
		});

		return entitlements;
	});
}

export async function assertMinPlan(
	userId: string,
	minimum: BillingPlan,
): Promise<EffectiveEntitlements> {
	const entitlements = await getEffectiveEntitlements(userId);
	const rank: Record<BillingPlan, number> = {
		[BillingPlan.FREE]: 0,
		[BillingPlan.PRO]: 1,
		[BillingPlan.TEAM]: 2,
	};

	if (rank[entitlements.billingPlan] < rank[minimum]) {
		throw new PlanEnforcementError(
			403,
			"PLAN_REQUIRED",
			`This feature requires ${minimum} or higher.`,
		);
	}

	return entitlements;
}

export function teamSeatsOrThrow(plan: BillingPlan, seats: number): number {
	if (plan !== BillingPlan.TEAM) {
		return 1;
	}
	if (seats < PLAN_LIMITS.TEAM.minTeamSeats || seats > PLAN_LIMITS.TEAM.maxTeamSeats) {
		throw new PlanEnforcementError(
			400,
			"INVALID_SEATS",
			`Team seats must be between ${PLAN_LIMITS.TEAM.minTeamSeats} and ${PLAN_LIMITS.TEAM.maxTeamSeats}.`,
		);
	}
	return seats;
}

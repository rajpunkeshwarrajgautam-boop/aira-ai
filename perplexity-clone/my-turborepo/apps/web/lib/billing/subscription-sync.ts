import {
	BillingPlan,
	SubscriptionStatus,
} from "../../../../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import type { CashfreeSubscriptionEntity } from "./cashfree-client";
import { getCashfreeConfig } from "./cashfree-config";

function normalizeCfStatus(raw: string | undefined): string {
	if (!raw) return "";
	return raw.toUpperCase().replace(/\s+/g, "_");
}

export function mapCashfreeStatusToPrisma(
	cashfreeStatus: string | undefined,
): SubscriptionStatus {
	const s = normalizeCfStatus(cashfreeStatus);
	switch (s) {
		case "ACTIVE":
			return SubscriptionStatus.ACTIVE;
		case "TRIALING":
		case "TRIAL":
			return SubscriptionStatus.TRIALING;
		case "INITIALIZED":
		case "LINK_EXPIRED":
			return SubscriptionStatus.INCOMPLETE;
		case "CUSTOMER_PAUSED":
		case "ON_HOLD":
			return SubscriptionStatus.PAUSED;
		case "PAST_DUE":
		case "UNPAID":
			return SubscriptionStatus.PAST_DUE;
		case "CUSTOMER_CANCELLED":
		case "CANCELLED":
		case "CUSTOMER_CANCELED":
		case "EXPIRED":
		case "COMPLETED":
			return SubscriptionStatus.CANCELED;
		default:
			return SubscriptionStatus.INCOMPLETE;
	}
}

function parseCfDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function billingPlanFromCashfreePlanId(
	planId: string | undefined,
	fallback: BillingPlan,
): BillingPlan {
	const cfg = getCashfreeConfig();
	if (planId === cfg.teamPlanId) {
		return BillingPlan.TEAM;
	}
	if (planId === cfg.proPlanId) {
		return BillingPlan.PRO;
	}
	return fallback;
}

export interface SyncSubscriptionArgs {
	readonly userId: string;
	readonly entity: CashfreeSubscriptionEntity;
	readonly fallbackPlan: BillingPlan;
	/** When omitted (webhooks), existing TEAM seats are preserved. */
	readonly teamSeats?: number;
}

/**
 * Upserts `BillingSubscription` and denormalizes `User.billingPlan` for active paid states.
 */
export async function syncSubscriptionFromCashfreeEntity(
	args: SyncSubscriptionArgs,
): Promise<void> {
	const { userId, entity, fallbackPlan, teamSeats: teamSeatsArg } = args;

	const cfId = entity.cf_subscription_id;
	const merchantId = entity.subscription_id;
	if (!cfId || !merchantId) {
		throw new Error("Cashfree subscription payload missing identifiers.");
	}

	const cfg = getCashfreeConfig();
	const planId = entity.plan_details?.plan_id;
	const plan = billingPlanFromCashfreePlanId(planId, fallbackPlan);

	const status = mapCashfreeStatusToPrisma(entity.subscription_status);
	const periodEnd = parseCfDate(entity.subscription_expiry_time ?? undefined);
	const periodStart = parseCfDate(
		entity.subscription_first_charge_time ?? undefined,
	);

	const paidActive =
		status === SubscriptionStatus.ACTIVE ||
		status === SubscriptionStatus.TRIALING;

	const userBillingPlan = paidActive ? plan : BillingPlan.FREE;

	await prisma.$transaction(async (tx) => {
		const existing = await tx.billingSubscription.findUnique({
			where: { userId },
		});

		const resolvedTeamSeats =
			plan === BillingPlan.TEAM
				? teamSeatsArg ??
					existing?.teamSeats ??
					1
				: 1;

		const cashfreePlanKey =
			planId && planId.length > 0
				? planId
				: plan === BillingPlan.TEAM
					? cfg.teamPlanId
					: cfg.proPlanId;

		await tx.billingSubscription.upsert({
			where: { userId },
			create: {
				userId,
				cfSubscriptionId: cfId,
				merchantSubscriptionId: merchantId,
				cashfreePlanId: cashfreePlanKey,
				plan,
				status,
				currentPeriodStart: periodStart,
				currentPeriodEnd: periodEnd,
				teamSeats: resolvedTeamSeats,
			},
			update: {
				cfSubscriptionId: cfId,
				merchantSubscriptionId: merchantId,
				cashfreePlanId: cashfreePlanKey,
				plan,
				status,
				currentPeriodStart: periodStart,
				currentPeriodEnd: periodEnd,
				teamSeats: resolvedTeamSeats,
			},
		});

		await tx.user.update({
			where: { id: userId },
			data: { billingPlan: userBillingPlan },
		});
	});
}

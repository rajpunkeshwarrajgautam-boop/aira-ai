import { randomBytes } from "node:crypto";

import { BillingPlan } from "../../../../../../generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import {
	cashfreeCreateSubscription,
	cashfreeGetSubscription,
	type CreateCashfreeSubscriptionInput,
} from "./cashfree-client";
import { getBillingReturnUrl, getCashfreeConfig } from "./cashfree-config";
import type { PaidCheckoutPlan } from "./plans";
import { billingPlanFromCheckout, PLAN_LIMITS } from "./plans";
import { syncSubscriptionFromCashfreeEntity } from "./subscription-sync";

function buildMerchantSubscriptionId(userId: string): string {
	const suffix = randomBytes(12).toString("base64url");
	return `sub_${userId}_${suffix}`;
}

function subscriptionExpiryIso(): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() + 10);
	return d.toISOString();
}

export interface StartCheckoutInput {
	readonly userId: string;
	readonly userEmail: string;
	readonly userName: string | null;
	readonly checkoutPlan: PaidCheckoutPlan;
	readonly teamSeats: number;
	readonly customerPhone: string;
}

export interface StartCheckoutResult {
	readonly merchantSubscriptionId: string;
	readonly subscriptionSessionId: string;
	readonly cfSubscriptionId: string;
}

/**
 * Creates a Cashfree subscription session and persists the pending row for webhook correlation.
 */
export async function startSubscriptionCheckout(
	input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
	const cfg = getCashfreeConfig();
	const billingPlan = billingPlanFromCheckout(input.checkoutPlan);

	if (billingPlan === BillingPlan.TEAM) {
		const seats = input.teamSeats;
		if (
			seats < PLAN_LIMITS.TEAM.minTeamSeats ||
			seats > PLAN_LIMITS.TEAM.maxTeamSeats
		) {
			throw new Error("Invalid team seat count for TEAM checkout.");
		}
	}

	const planId =
		billingPlan === BillingPlan.TEAM ? cfg.teamPlanId : cfg.proPlanId;
	const planType =
		billingPlan === BillingPlan.TEAM ? cfg.teamPlanType : cfg.proPlanType;
	const merchantSubscriptionId = buildMerchantSubscriptionId(input.userId);

	const phone = input.customerPhone.replace(/\s+/g, "");
	if (phone.length < 8) {
		throw new Error("customerPhone must be a valid phone number for Cashfree.");
	}

	const payload: CreateCashfreeSubscriptionInput = {
		subscription_id: merchantSubscriptionId,
		subscription_expiry_time: subscriptionExpiryIso(),
		customer_details: {
			customer_name: input.userName ?? "Customer",
			customer_email: input.userEmail,
			customer_phone: phone,
		},
		plan_details: {
			plan_id: planId,
			plan_name: billingPlan === BillingPlan.TEAM ? "Team" : "Pro",
			plan_type: planType,
		},
		authorization_details: {
			authorization_amount: cfg.authorizationAmount,
			authorization_amount_refund: cfg.authorizationAmountRefund,
			authorization_time: cfg.authorizationTimeMinutes,
		},
		subscription_meta: {
			return_url: `${getBillingReturnUrl()}/api/billing/return`,
			notification_channel: ["EMAIL"],
		},
		subscription_tags: {
			app_user_id: input.userId,
			billing_plan: String(billingPlan),
			team_seats: String(
				billingPlan === BillingPlan.TEAM ? input.teamSeats : 1,
			),
		},
	};

	const entity = await cashfreeCreateSubscription(payload);
	const cfId = entity.cf_subscription_id;
	const sessionId = entity.subscription_session_id;
	if (!cfId || !sessionId) {
		throw new Error("Cashfree did not return subscription session identifiers.");
	}

	await syncSubscriptionFromCashfreeEntity({
		userId: input.userId,
		entity,
		fallbackPlan: billingPlan,
		teamSeats: billingPlan === BillingPlan.TEAM ? input.teamSeats : 1,
	});

	await prisma.user.update({
		where: { id: input.userId },
		data: { billingPhone: phone },
	});

	return {
		merchantSubscriptionId,
		subscriptionSessionId: sessionId,
		cfSubscriptionId: cfId,
	};
}

/**
 * Server-side verification: fetches authoritative subscription state from Cashfree and syncs Prisma.
 */
export async function verifySubscriptionAndSync(args: {
	readonly userId: string;
	readonly merchantSubscriptionId: string;
}): Promise<void> {
	const local = await prisma.billingSubscription.findUnique({
		where: { userId: args.userId },
	});
	if (!local || local.merchantSubscriptionId !== args.merchantSubscriptionId) {
		throw new Error("Subscription does not belong to the authenticated user.");
	}

	const remote = await cashfreeGetSubscription(args.merchantSubscriptionId);
	await syncSubscriptionFromCashfreeEntity({
		userId: args.userId,
		entity: remote,
		fallbackPlan: local.plan,
		teamSeats: local.teamSeats,
	});
}

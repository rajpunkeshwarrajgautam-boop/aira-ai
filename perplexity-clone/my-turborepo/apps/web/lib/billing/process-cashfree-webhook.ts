import { createHash } from "node:crypto";

import { BillingPlan, SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { mapCashfreeStatusToPrisma } from "./subscription-sync";

import { cashfreeGetSubscription } from "./cashfree-client";
import { resolveCashfreeWebhookSecret } from "./cashfree-config";
import { syncSubscriptionFromCashfreeEntity } from "./subscription-sync";
import { verifyCashfreeWebhookSignature } from "./webhook-verify";
import { trackUpgradeCompletedEvent } from "@/lib/analytics/analytics-service";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function extractMerchantSubscriptionId(payload: unknown): string | null {
	const root = asRecord(payload);
	if (!root) {
		return null;
	}
	const data = asRecord(root["data"]);
	const details =
		asRecord(data?.["subscription_details"]) ??
		asRecord(data?.["subscription"]) ??
		asRecord(root["subscription_details"]);
	const id = details?.["subscription_id"];
	return typeof id === "string" && id.length > 0 ? id : null;
}

function fallbackPlanFromTags(
	tags: Record<string, string> | undefined,
): BillingPlan {
	const raw = tags?.billing_plan;
	if (raw === BillingPlan.TEAM) {
		return BillingPlan.TEAM;
	}
	if (raw === BillingPlan.PRO) {
		return BillingPlan.PRO;
	}
	return BillingPlan.PRO;
}

function teamSeatsFromTags(
	tags: Record<string, string> | undefined,
): number | undefined {
	const raw = tags?.team_seats;
	if (!raw) {
		return undefined;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

export async function handleCashfreeWebhookRequest(req: Request): Promise<Response> {
	const rawBody = await req.text();
	const secret = resolveCashfreeWebhookSecret();
	if (!verifyCashfreeWebhookSignature(rawBody, req.headers, secret)) {
		return new Response("Invalid signature", { status: 400 });
	}

	const dedupeId = createHash("sha256").update(rawBody).digest("hex");
	try {
		await prisma.processedCashfreeWebhook.create({ data: { id: dedupeId } });
	} catch {
		return new Response("OK", { status: 200 });
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const merchantId = extractMerchantSubscriptionId(parsed);
	if (!merchantId) {
		return new Response("OK", { status: 200 });
	}

	const local = await prisma.billingSubscription.findUnique({
		where: { merchantSubscriptionId: merchantId },
	});

	const remote = await cashfreeGetSubscription(merchantId);
	const tagUserId = remote.subscription_tags?.app_user_id;
	const userId = local?.userId ?? tagUserId;
	if (!userId) {
		return new Response("OK", { status: 200 });
	}

	if (local && local.userId !== userId) {
		return new Response("OK", { status: 200 });
	}

	const fallback = local?.plan ?? fallbackPlanFromTags(remote.subscription_tags);
	const seats = teamSeatsFromTags(remote.subscription_tags);

	const mappedStatus = mapCashfreeStatusToPrisma(remote.subscription_status);
	const paidActive =
		mappedStatus === SubscriptionStatus.ACTIVE ||
		mappedStatus === SubscriptionStatus.TRIALING;

	await syncSubscriptionFromCashfreeEntity({
		userId,
		entity: remote,
		fallbackPlan: fallback,
		...(seats !== undefined ? { teamSeats: seats } : {}),
	});

	if (paidActive) {
		await trackUpgradeCompletedEvent({
			userId,
			plan: fallback,
		});
	}

	return new Response("OK", { status: 200 });
}

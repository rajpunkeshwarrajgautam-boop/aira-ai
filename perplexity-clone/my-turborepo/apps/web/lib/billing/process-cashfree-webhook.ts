import { createHash } from "node:crypto";

import { BillingPlan, SubscriptionStatus } from "@/generated/prisma/enums";
import { trackUpgradeCompletedEvent } from "@/lib/analytics/analytics-service";
import { prisma } from "@/lib/prisma";

import { cashfreeGetSubscription } from "./cashfree-client";
import { resolveCashfreeWebhookSecret } from "./cashfree-config";
import {
	mapCashfreeStatusToPrisma,
	syncSubscriptionFromCashfreeEntity,
} from "./subscription-sync";
import { verifyCashfreeWebhookSignature } from "./webhook-verify";

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
	const statusWebhook = asRecord(data?.["subscription_status_webhook"]);
	const details =
		asRecord(data?.["subscription_details"]) ??
		asRecord(data?.["subscription"]) ??
		asRecord(statusWebhook?.["subscription_details"]) ??
		asRecord(root["subscription_details"]);
	// Payment success/failed/cancelled payloads in the 2025 and 2026 API
	// versions can omit `subscription_details` and expose the merchant
	// subscription reference directly under `data`.
	const id = details?.["subscription_id"] ?? data?.["subscription_id"];
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

function isUniqueConstraintError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { readonly code?: unknown }).code === "P2002"
	);
}

async function claimWebhook(dedupeId: string): Promise<boolean> {
	try {
		await prisma.processedCashfreeWebhook.create({ data: { id: dedupeId } });
		return true;
	} catch (error) {
		if (isUniqueConstraintError(error)) return false;
		throw error;
	}
}

async function releaseWebhookClaim(dedupeId: string): Promise<void> {
	try {
		await prisma.processedCashfreeWebhook.delete({ where: { id: dedupeId } });
	} catch (error) {
		console.error("[billing:webhook] Failed to release webhook claim", error);
	}
}

async function processVerifiedCashfreeWebhook(
	merchantId: string,
): Promise<void> {
	const local = await prisma.billingSubscription.findUnique({
		where: { merchantSubscriptionId: merchantId },
	});

	const remote = await cashfreeGetSubscription(merchantId);
	const tagUserId = remote.subscription_tags?.app_user_id;
	const userId = local?.userId ?? tagUserId;
	if (!userId) return;

	if (local && local.userId !== userId) return;

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
}

export async function handleCashfreeWebhookRequest(req: Request): Promise<Response> {
	const rawBody = await req.text();
	const secret = resolveCashfreeWebhookSecret();
	if (!verifyCashfreeWebhookSignature(rawBody, req.headers, secret)) {
		return new Response("Invalid signature", { status: 400 });
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

	const dedupeId = createHash("sha256").update(rawBody).digest("hex");
	const claimed = await claimWebhook(dedupeId);
	if (!claimed) return new Response("OK", { status: 200 });

	try {
		await processVerifiedCashfreeWebhook(merchantId);
	} catch (error) {
		// A failed claim must be released so Cashfree's next retry can process it.
		await releaseWebhookClaim(dedupeId);
		throw error;
	}

	return new Response("OK", { status: 200 });
}

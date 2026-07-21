import { getCashfreeConfig } from "./cashfree-config";

const CASHFREE_REQUEST_TIMEOUT_MS = 20_000;

export interface CashfreeCustomerDetails {
	readonly customer_name: string;
	readonly customer_email: string;
	readonly customer_phone: string;
}

export interface CreateCashfreeSubscriptionInput {
	readonly subscription_id: string;
	readonly subscription_expiry_time: string;
	readonly customer_details: CashfreeCustomerDetails;
	readonly plan_details: {
		readonly plan_id: string;
		readonly plan_name: string;
		readonly plan_type: string;
	};
	readonly authorization_details: {
		readonly authorization_amount: number;
		readonly authorization_amount_refund: boolean;
		readonly authorization_time: number;
	};
	readonly subscription_meta: {
		readonly return_url: string;
		readonly notification_channel: readonly ("EMAIL" | "SMS")[];
	};
	readonly subscription_tags?: Record<string, string>;
}

/** Shape returned by Cashfree PG for subscription create / fetch (subset we use). */
export interface CashfreeSubscriptionEntity {
	readonly cf_subscription_id?: string;
	readonly subscription_id?: string;
	readonly subscription_status?: string;
	readonly subscription_expiry_time?: string | null;
	readonly subscription_first_charge_time?: string | null;
	readonly subscription_session_id?: string | null;
	readonly subscription_tags?: Record<string, string>;
	readonly plan_details?: {
		readonly plan_id?: string;
	};
}

function cashfreeHeaders(): Record<string, string> {
	const cfg = getCashfreeConfig();
	return {
		accept: "application/json",
		"content-type": "application/json",
		"x-api-version": cfg.apiVersion,
		"x-client-id": cfg.clientId,
		"x-client-secret": cfg.clientSecret,
	};
}

export async function cashfreeCreateSubscription(
	body: CreateCashfreeSubscriptionInput,
): Promise<CashfreeSubscriptionEntity> {
	const cfg = getCashfreeConfig();
	const res = await fetch(`${cfg.baseUrl}/subscriptions`, {
		method: "POST",
		headers: cashfreeHeaders(),
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(CASHFREE_REQUEST_TIMEOUT_MS),
	});

	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		throw new Error(`Cashfree create subscription returned invalid JSON (${res.status}).`);
	}

	if (!res.ok) {
		throw new Error(`Cashfree create subscription failed (${res.status}).`);
	}

	return json as CashfreeSubscriptionEntity;
}

/** `subscriptionId` is the merchant reference (`subscription_id`). */
export async function cashfreeGetSubscription(
	subscriptionId: string,
): Promise<CashfreeSubscriptionEntity> {
	const cfg = getCashfreeConfig();
	const encoded = encodeURIComponent(subscriptionId);
	const res = await fetch(`${cfg.baseUrl}/subscriptions/${encoded}`, {
		method: "GET",
		headers: {
			accept: "application/json",
			"x-api-version": cfg.apiVersion,
			"x-client-id": cfg.clientId,
			"x-client-secret": cfg.clientSecret,
		},
		signal: AbortSignal.timeout(CASHFREE_REQUEST_TIMEOUT_MS),
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Cashfree get subscription failed (${res.status}).`);
	}

	try {
		return text ? (JSON.parse(text) as CashfreeSubscriptionEntity) : {};
	} catch {
		throw new Error("Cashfree get subscription returned invalid JSON.");
	}
}

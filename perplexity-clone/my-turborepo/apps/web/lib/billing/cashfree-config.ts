export type CashfreeEnvironment = "sandbox" | "production";

export interface CashfreeConfig {
	readonly baseUrl: string;
	readonly clientId: string;
	readonly clientSecret: string;
	readonly webhookSecret: string;
	readonly apiVersion: string;
	readonly proPlanId: string;
	readonly teamPlanId: string;
	readonly proPlanType: string;
	readonly teamPlanType: string;
	readonly authorizationAmount: number;
	readonly authorizationAmountRefund: boolean;
	readonly authorizationTimeMinutes: number;
}

export function resolveCashfreeWebhookSecret(): string {
	const webhookSecret =
		process.env.CASHFREE_WEBHOOK_SECRET ?? process.env.CASHFREE_CLIENT_SECRET;
	if (!webhookSecret) {
		throw new Error(
			"CASHFREE_WEBHOOK_SECRET or CASHFREE_CLIENT_SECRET must be configured.",
		);
	}
	return webhookSecret;
}

function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) {
		throw new Error(`${name} is not configured.`);
	}
	return v;
}

export function getCashfreeConfig(): CashfreeConfig {
	const envName = (process.env.CASHFREE_ENV ?? "sandbox").toLowerCase();
	const environment: CashfreeEnvironment =
		envName === "production" ? "production" : "sandbox";

	const baseUrl =
		environment === "production"
			? "https://api.cashfree.com/pg"
			: "https://sandbox.cashfree.com/pg";

	return {
		baseUrl,
		clientId: requireEnv("CASHFREE_CLIENT_ID"),
		clientSecret: requireEnv("CASHFREE_CLIENT_SECRET"),
		webhookSecret: resolveCashfreeWebhookSecret(),
		apiVersion: process.env.CASHFREE_API_VERSION ?? "2025-01-01",
		proPlanId: requireEnv("CASHFREE_PRO_PLAN_ID"),
		teamPlanId: requireEnv("CASHFREE_TEAM_PLAN_ID"),
		proPlanType: process.env.CASHFREE_PRO_PLAN_TYPE ?? "PERIODIC",
		teamPlanType: process.env.CASHFREE_TEAM_PLAN_TYPE ?? "PERIODIC",
		authorizationAmount: Number(process.env.CASHFREE_AUTH_AMOUNT ?? 1),
		authorizationAmountRefund:
			(process.env.CASHFREE_AUTH_REFUND ?? "true").toLowerCase() !== "false",
		authorizationTimeMinutes: Number(process.env.CASHFREE_AUTH_TIME_MIN ?? 1),
	};
}

export function getBillingReturnUrl(): string {
	const explicit = process.env.BILLING_CHECKOUT_RETURN_URL;
	if (explicit) {
		return explicit.replace(/\/$/, "");
	}
	const base =
		process.env.NEXTAUTH_URL ??
		process.env.AUTH_URL ??
		(process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
	if (!base) {
		throw new Error(
			"Set BILLING_CHECKOUT_RETURN_URL or NEXTAUTH_URL (or AUTH_URL) for subscription return redirects.",
		);
	}
	return base.replace(/\/$/, "");
}

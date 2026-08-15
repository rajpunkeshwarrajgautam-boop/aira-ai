export type CashfreeEnvironment = "sandbox" | "production";

export interface CashfreeConfig {
	readonly baseUrl: string;
	readonly clientId: string;
	readonly clientSecret: string;
	readonly webhookSecret: string;
	readonly apiVersion: string;
	readonly planCurrency: string;
	readonly proMonthlyAmount: number;
	readonly teamSeatMonthlyAmount: number;
	readonly planMaxCycles: number;
	readonly authorizationAmountRefund: boolean;
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

function positiveNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive number.`);
	}
	return value;
}

export function getCashfreeConfig(): CashfreeConfig {
	const envName = (process.env.CASHFREE_ENV ?? "sandbox").toLowerCase();
	const environment: CashfreeEnvironment =
		envName === "production" ? "production" : "sandbox";

	const baseUrl =
		environment === "production"
			? "https://api.cashfree.com/pg"
			: "https://sandbox.cashfree.com/pg";

	const planCurrency = (process.env.CASHFREE_PLAN_CURRENCY ?? "USD").toUpperCase();
	if (!/^[A-Z]{3}$/.test(planCurrency)) {
		throw new Error("CASHFREE_PLAN_CURRENCY must be a three-letter currency code.");
	}

	return {
		baseUrl,
		clientId: requireEnv("CASHFREE_CLIENT_ID"),
		clientSecret: requireEnv("CASHFREE_CLIENT_SECRET"),
		webhookSecret: resolveCashfreeWebhookSecret(),
		apiVersion: process.env.CASHFREE_API_VERSION ?? "2026-01-01",
		planCurrency,
		proMonthlyAmount: positiveNumber("CASHFREE_PRO_MONTHLY_AMOUNT", 20),
		teamSeatMonthlyAmount: positiveNumber(
			"CASHFREE_TEAM_SEAT_MONTHLY_AMOUNT",
			15,
		),
		planMaxCycles: Math.trunc(positiveNumber("CASHFREE_PLAN_MAX_CYCLES", 120)),
		authorizationAmountRefund:
			(process.env.CASHFREE_AUTH_REFUND ?? "false").toLowerCase() === "true",
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

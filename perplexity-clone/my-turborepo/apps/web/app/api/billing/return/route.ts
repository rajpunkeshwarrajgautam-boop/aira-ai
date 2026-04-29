import { getBillingReturnUrl } from "@/lib/billing/cashfree-config";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * Cashfree redirects the customer here after mandate / auth completes.
 * Query parameter names can vary; we forward common aliases to the SPA entry.
 */
export async function GET(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const merchantSubscriptionId =
		url.searchParams.get("subscription_id") ??
		url.searchParams.get("subscriptionId") ??
		url.searchParams.get("merchant_subscription_id");

	const base = getBillingReturnUrl();
	const target = new URL(base);
	target.searchParams.set("billing", "return");
	if (merchantSubscriptionId) {
		target.searchParams.set(
			"merchantSubscriptionId",
			merchantSubscriptionId,
		);
	}

	return Response.redirect(target.toString(), 302);
}

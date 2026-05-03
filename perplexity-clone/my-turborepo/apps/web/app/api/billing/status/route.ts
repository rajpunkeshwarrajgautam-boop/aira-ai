import { auth } from "@/auth";
import { getBillingUsageSummary } from "@/lib/billing/plan-enforcement";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const summary = await getBillingUsageSummary(session.user.id);
	return Response.json({
		billingPlan: summary.billingPlan,
		teamSeats: summary.teamSeats,
		monthlySearchLimit: summary.monthlySearchLimit,
		searchesUsed: summary.searchesUsed,
		searchesRemaining: summary.searchesRemaining,
	});
}

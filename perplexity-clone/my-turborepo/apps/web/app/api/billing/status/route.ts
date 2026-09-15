import { auth } from "@/auth";
import { getBillingUsageSummary, PlanEnforcementError } from "@/lib/billing/plan-enforcement";

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

	try {
		const summary = await getBillingUsageSummary(session.user.id);
		return Response.json({
			billingPlan: summary.billingPlan,
			teamSeats: summary.teamSeats,
			monthlySearchLimit: summary.monthlySearchLimit,
			searchesUsed: summary.searchesUsed,
			searchesRemaining: summary.searchesRemaining,
			monthlyAgentRunLimit: summary.monthlyAgentRunLimit,
			agentRunsUsed: summary.agentRunsUsed,
			agentRunsRemaining: summary.agentRunsRemaining,
		});
	} catch (error) {
		if (error instanceof PlanEnforcementError) {
			return Response.json(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status },
			);
		}
		return Response.json(
			{ error: { code: "BILLING_UNAVAILABLE", message: "Billing usage is temporarily unavailable." } },
			{ status: 503 },
		);
	}
}

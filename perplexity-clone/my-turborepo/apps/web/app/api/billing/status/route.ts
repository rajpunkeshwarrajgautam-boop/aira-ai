import { auth } from "@/auth";
import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";

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

	const entitlements = await getEffectiveEntitlements(session.user.id);
	return Response.json({
		billingPlan: entitlements.billingPlan,
		teamSeats: entitlements.teamSeats,
		monthlySearchLimit: entitlements.monthlySearchLimit,
	});
}

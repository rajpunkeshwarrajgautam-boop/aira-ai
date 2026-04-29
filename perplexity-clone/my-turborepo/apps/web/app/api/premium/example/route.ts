import { auth } from "@/auth";
import {
	assertMinPlan,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { BillingPlan } from "../../../../../../../../generated/prisma/enums";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * Example premium-only endpoint. Requires an active paid plan (PRO or TEAM).
 * Replace with real premium capabilities (exports, connectors, etc.).
 */
export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	try {
		const entitlements = await assertMinPlan(
			session.user.id,
			BillingPlan.PRO,
		);
		return Response.json({
			ok: true,
			billingPlan: entitlements.billingPlan,
		});
	} catch (e) {
		if (e instanceof PlanEnforcementError) {
			return Response.json(
				{ error: { code: e.code, message: e.message } },
				{ status: e.status },
			);
		}
		throw e;
	}
}

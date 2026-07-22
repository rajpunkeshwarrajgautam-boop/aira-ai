import { z } from "zod";

import { auth } from "@/auth";
import { getOrCreateAnonymousIdCookie } from "@/lib/analytics/anon-id";
import {
	ensureSignupCompletedTracked,
	trackErrorEvent,
	trackUpgradeCheckoutStartedEvent,
} from "@/lib/analytics/analytics-service";
import { startSubscriptionCheckout } from "@/lib/billing/billing-service";
import {
	PlanEnforcementError,
	teamSeatsOrThrow,
} from "@/lib/billing/plan-enforcement";
import { PLAN_LIMITS } from "@/lib/billing/plans";
import { BillingPlan } from "@/generated/prisma/enums";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
	plan: z.enum(["pro", "team"]),
	teamSeats: z.number().int().positive().optional(),
	customerPhone: z.string().min(8).max(32),
});

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id || !session.user.email) {
		return Response.json(
			{
				error: {
					code: "UNAUTHENTICATED",
					message: "Sign in to start checkout.",
				},
			},
			{ status: 401 },
		);
	}

	const anonymousId = await getOrCreateAnonymousIdCookie();

	let json: unknown;
	try {
		json = await req.json();
	} catch {
		return Response.json(
			{ error: { code: "INVALID_JSON", message: "Body must be JSON." } },
			{ status: 400 },
		);
	}

	const parsed = BodySchema.safeParse(json);
	if (!parsed.success) {
		return Response.json(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: "Invalid request body.",
					details: z.treeifyError(parsed.error),
				},
			},
			{ status: 400 },
		);
	}

	const seats =
		parsed.data.plan === "team"
			? teamSeatsOrThrow(
					BillingPlan.TEAM,
					parsed.data.teamSeats ?? PLAN_LIMITS.TEAM.minTeamSeats,
				)
			: 1;

	try {
		const desiredPlan =
			parsed.data.plan === "team" ? BillingPlan.TEAM : BillingPlan.PRO;
		await ensureSignupCompletedTracked({
			userId: session.user.id,
			anonymousId,
			plan: desiredPlan,
		});

		await trackUpgradeCheckoutStartedEvent({
			userId: session.user.id,
			anonymousId,
			plan: desiredPlan,
			teamSeats: seats,
		});

		const result = await startSubscriptionCheckout({
			userId: session.user.id,
			userEmail: session.user.email,
			userName: session.user.name ?? null,
			checkoutPlan: parsed.data.plan,
			teamSeats: seats,
			customerPhone: parsed.data.customerPhone,
		});

		return Response.json({
			subscriptionSessionId: result.subscriptionSessionId,
			merchantSubscriptionId: result.merchantSubscriptionId,
			cfSubscriptionId: result.cfSubscriptionId,
			cashfreeJsEnv:
				process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
		});
	} catch (e) {
		if (e instanceof PlanEnforcementError) {
			await trackErrorEvent({
				userId: session.user.id,
				anonymousId,
				code: e.code,
				message: e.message,
			});
			return Response.json(
				{ error: { code: e.code, message: e.message } },
				{ status: e.status },
			);
		}
		console.error("[billing:checkout]", e);
		return Response.json(
			{
				error: {
					code: "CHECKOUT_FAILED",
					message: "Checkout could not be started. Please retry.",
				},
			},
			{ status: 502 },
		);
	}
}

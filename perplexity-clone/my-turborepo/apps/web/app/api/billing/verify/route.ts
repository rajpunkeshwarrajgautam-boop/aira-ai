import { z } from "zod";

import { auth } from "@/auth";
import { verifySubscriptionAndSync } from "@/lib/billing/billing-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
	merchantSubscriptionId: z.string().min(4).max(128),
});

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

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

	try {
		await verifySubscriptionAndSync({
			userId: session.user.id,
			merchantSubscriptionId: parsed.data.merchantSubscriptionId,
		});
		return Response.json({ ok: true });
	} catch (e) {
		console.error("[billing:verify]", e);
		return Response.json(
			{
				error: {
					code: "VERIFY_FAILED",
					message: "Subscription verification could not be completed.",
				},
			},
			{ status: 502 },
		);
	}
}

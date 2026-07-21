import { z } from "zod";

import { auth } from "@/auth";
import { getOrCreateAnonymousIdCookie } from "@/lib/analytics/anon-id";
import {
	trackErrorEvent,
	trackShareCreatedEvent,
} from "@/lib/analytics/analytics-service";
import {
	ensurePublicShareTokenForResearchByConversationAndMessage,
	ensurePublicShareTokenForResearchHistory,
	buildShareUrl,
} from "@/lib/research-share";
import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
	.object({
		researchHistoryId: z.string().min(3).optional(),
		conversationId: z.string().min(3).optional(),
		messageId: z.string().min(3).optional(),
	})
	.refine(
		(v) =>
			(v.researchHistoryId !== undefined) ||
			(v.conversationId !== undefined && v.messageId !== undefined),
		{ message: "Provide researchHistoryId or both conversationId and messageId." },
	);

function buildBaseUrlFromRequest(req: Request): string {
	const configured = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
	if (configured) return new URL(configured).origin;
	return new URL(req.url).origin;
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
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
					message: parsed.error.issues[0]?.message ?? "Invalid request body.",
				},
			},
			{ status: 400 },
		);
	}

	try {
		const baseUrl = buildBaseUrlFromRequest(req);
		let token: string;

		if (parsed.data.researchHistoryId) {
			const ensured = await ensurePublicShareTokenForResearchHistory({
				userId: session.user.id,
				researchHistoryId: parsed.data.researchHistoryId,
			});
			token = ensured.token;
		} else {
			const ensured = await ensurePublicShareTokenForResearchByConversationAndMessage({
				userId: session.user.id,
				conversationId: parsed.data.conversationId!,
				messageId: parsed.data.messageId!,
			});
			token = ensured.token;
		}

		const entitlements = await getEffectiveEntitlements(session.user.id);

		await trackShareCreatedEvent({
			userId: session.user.id,
			anonymousId,
			plan: entitlements.billingPlan,
		});

		return Response.json({
			shareId: token,
			url: buildShareUrl(token, baseUrl),
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Unknown error.";

		await trackErrorEvent({
			userId: session.user.id,
			anonymousId,
			code: "SHARE_ERROR",
			message: msg,
		});

		if (msg === "RESEARCH_NOT_FOUND") {
			return Response.json(
				{ error: { code: "NOT_FOUND", message: "Research not found." } },
				{ status: 404 },
			);
		}
		return Response.json(
			{
				error: {
					code: "INTERNAL_ERROR",
					message: "Unable to create a share link.",
				},
			},
			{ status: 500 },
		);
	}
}

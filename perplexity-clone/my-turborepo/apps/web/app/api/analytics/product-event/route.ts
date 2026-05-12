import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ProductEventNameSchema = z.enum([
	"search_submitted",
	"answer_stream_started",
	"answer_completed",
	"citation_clicked",
	"source_opened",
	"example_query_clicked",
	"sign_in_clicked",
	"guest_quota_reached",
	"deep_research_clicked",
	"share_clicked",
	"guest_search_started",
	"feedback_clicked",
]);

const BodySchema = z.object({
	event: ProductEventNameSchema,
	surface: z.string().trim().min(1).max(64).optional(),
	userType: z.enum(["guest", "signed_in"]).optional(),
	queryLength: z.number().int().min(0).max(1_000_000).optional(),
	sourceCount: z.number().int().min(0).max(10_000).optional(),
	citationCount: z.number().int().min(0).max(10_000).optional(),
	citationIndex: z.number().int().min(1).max(10_000).optional(),
	sourceDomain: z.string().trim().min(1).max(256).optional(),
	conversationId: z.string().trim().min(1).max(128).optional(),
	messageId: z.string().trim().min(1).max(128).optional(),
	errorCode: z.string().trim().min(1).max(64).optional(),
});

/**
 * Logs coarse product events to server stdout (e.g. Vercel logs) and persists to DB.
 * Do not extend this schema with query text, answers, or secrets.
 */
export async function POST(req: Request): Promise<Response> {
	let json: unknown;
	try {
		json = await req.json();
	} catch {
		return Response.json({ ok: false }, { status: 400 });
	}

	const parsed = BodySchema.safeParse(json);
	if (!parsed.success) {
		return Response.json({ ok: false }, { status: 400 });
	}

	const d = parsed.data;

	// 1. Log to stdout (keep existing behavior)
	const line = JSON.stringify({
		kind: "product_event",
		event: d.event,
		surface: d.surface ?? null,
		userType: d.userType ?? null,
		queryLength: d.queryLength ?? null,
		sourceCount: d.sourceCount ?? null,
		citationCount: d.citationCount ?? null,
		citationIndex: d.citationIndex ?? null,
		sourceDomain: d.sourceDomain ?? null,
		conversationId: d.conversationId ?? null,
		messageId: d.messageId ?? null,
		errorCode: d.errorCode ?? null,
		ts: new Date().toISOString(),
	});
	console.info(line);

	// 2. Persist to DB (Best effort, do not fail UX)
	try {
		await prisma.productAnalyticsEvent.create({
			data: {
				event: d.event,
				surface: d.surface ?? null,
				userType: d.userType ?? null,
				queryLength: d.queryLength ?? null,
				sourceCount: d.sourceCount ?? null,
				citationCount: d.citationCount ?? null,
				citationIndex: d.citationIndex ?? null,
				sourceDomain: d.sourceDomain ?? null,
				conversationId: d.conversationId ?? null,
				messageId: d.messageId ?? null,
				errorCode: d.errorCode ?? null,
			},
		});
	} catch (error) {
		// Swallow DB errors to prevent breaking UX
		console.error("Failed to persist product event to DB:", error);
	}

	return Response.json({ ok: true });
}

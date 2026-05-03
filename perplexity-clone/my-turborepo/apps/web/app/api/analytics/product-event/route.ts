import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
	event: z.enum(["guest_search_started", "share_clicked", "feedback_clicked"]),
	surface: z.string().trim().min(1).max(64).optional(),
	citationCount: z.number().int().min(0).max(10_000).optional(),
});

/**
 * Logs coarse product events to server stdout (e.g. Vercel logs). No DB writes.
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

	const { event, surface, citationCount } = parsed.data;
	const line = JSON.stringify({
		kind: "product_event",
		event,
		surface: surface ?? null,
		citationCount: citationCount ?? null,
		ts: new Date().toISOString(),
	});
	console.info(line);

	return Response.json({ ok: true });
}

import { z } from "zod";

import { ensureVisitorLandedTracked } from "@/lib/analytics/analytics-service";
import { getOrCreateAnonymousIdCookie } from "@/lib/analytics/anon-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
	noop: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
	// Public endpoint (no auth). Used only to record an anonymous visitor landing.
	// Never accept user-provided identifiers to avoid injection.
	try {
		let json: unknown = null;
		try {
			json = await req.json();
		} catch {
			// ignore
		}
		BodySchema.parse(json ?? {});
	} catch {
		// ignore validation failures for best-effort tracking
	}

	const anonymousId = await getOrCreateAnonymousIdCookie();
	await ensureVisitorLandedTracked({ anonymousId });

	return Response.json({ ok: true });
}


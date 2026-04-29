import { z } from "zod";

import { requireAnalyticsAdmin } from "@/lib/analytics/admin";
import { getDailyAnalyticsPoints } from "@/lib/analytics/analytics-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
	days: z.coerce.number().int().min(1).max(90).optional(),
});

export async function GET(req: Request): Promise<Response> {
	const session = await requireAnalyticsAdmin();
	void session; // only for auth/guard

	const url = new URL(req.url);
	const parsed = QuerySchema.safeParse({
		days: url.searchParams.get("days"),
	});
	if (!parsed.success) {
		return Response.json(
			{ error: { code: "VALIDATION_ERROR", message: "Invalid query." } },
			{ status: 400 },
		);
	}

	const days = parsed.data.days ?? 30;
	const points = await getDailyAnalyticsPoints({ days });
	return Response.json({ points });
}


import { z } from "zod";

import {
	analyticsAdminDeniedResponse,
	requireAnalyticsAdmin,
} from "@/lib/analytics/admin";
import { prisma } from "@/lib/prisma";
import { AnalyticsEventType } from "@/generated/prisma/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: Request): Promise<Response> {
	try {
		await requireAnalyticsAdmin();
	} catch {
		return analyticsAdminDeniedResponse();
	}

	const url = new URL(req.url);
	const parsed = QuerySchema.safeParse({ limit: url.searchParams.get("limit") });
	if (!parsed.success) {
		return Response.json(
			{ error: { code: "VALIDATION_ERROR", message: "Invalid query." } },
			{ status: 400 },
		);
	}

	const limit = parsed.data.limit ?? 50;

	const events = await prisma.analyticsEvent.findMany({
		where: {
			type: {
				in: ["SEARCH_ERROR", "ERROR_EVENT"] as AnalyticsEventType[],
			},
		},
		orderBy: { createdAt: "desc" },
		take: Math.min(limit, 200),
		select: {
			id: true,
			createdAt: true,
			type: true,
			userId: true,
			anonymousId: true,
			plan: true,
			metadata: true,
		},
	});

	return Response.json({ events });
}

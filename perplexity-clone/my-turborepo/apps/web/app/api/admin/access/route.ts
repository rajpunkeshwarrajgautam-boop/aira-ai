import { requireAnalyticsAdmin } from "@/lib/analytics/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	try {
		await requireAnalyticsAdmin();
		return Response.json(
			{ analyticsAdmin: true },
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch {
		return Response.json(
			{ analyticsAdmin: false },
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	}
}

import { auth } from "@/auth";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels } from "@services/omniroute/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		return Response.json(
			{
				enabled: config.enabled,
				configured: false,
				connected: false,
				model: config.model,
				modelCount: 0,
				message: config.enabled
					? "Set OMNIROUTE_BASE_URL and OMNIROUTE_API_KEY to finish configuration."
					: "OmniRoute is disabled on this deployment.",
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	try {
		const snapshot = await fetchOmniRouteModels();
		return Response.json(
			{
				enabled: true,
				configured: true,
				connected: true,
				model: config.model,
				modelCount: snapshot.models.length,
				latencyMs: snapshot.latencyMs,
				sampleModels: snapshot.models.slice(0, 8),
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		return Response.json(
			{
				enabled: true,
				configured: true,
				connected: false,
				model: config.model,
				modelCount: 0,
				message: error instanceof Error ? error.message : "OmniRoute health check failed.",
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}
}

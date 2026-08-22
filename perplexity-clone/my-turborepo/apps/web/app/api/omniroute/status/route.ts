import { auth } from "@/auth";
import { isOmniRoutePreviewTestAccessEnabled } from "@/lib/omniroute-preview-access";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels, OmniRouteGatewayError } from "@services/omniroute/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gatewayHost(baseURL: string): string | null {
	if (!baseURL) return null;
	try {
		return new URL(baseURL).host;
	} catch {
		return null;
	}
}

export async function GET(): Promise<Response> {
	if (!isOmniRoutePreviewTestAccessEnabled()) {
		const session = await auth();
		if (!session?.user?.id) {
			return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
		}
	}

	const config = getOmniRouteConfigOrDisabled();
	const host = gatewayHost(config.baseURL);
	if (!config.configured) {
		return Response.json(
			{
				enabled: config.enabled,
				configured: false,
				connected: false,
				model: config.model,
				modelCount: 0,
				gatewayHost: host,
				checkedAt: new Date().toISOString(),
				message: config.configurationError ?? (config.enabled
					? "Set OMNIROUTE_BASE_URL and OMNIROUTE_API_KEY to finish configuration."
					: "OmniRoute is disabled on this deployment."),
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
				gatewayHost: host,
				checkedAt: snapshot.checkedAt,
				version: snapshot.version,
				sampleModels: snapshot.models.slice(0, 8),
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		const message = error instanceof OmniRouteGatewayError ? error.message : "OmniRoute health check failed.";
		return Response.json(
			{
				enabled: true,
				configured: true,
				connected: false,
				model: config.model,
				modelCount: 0,
				gatewayHost: host,
				checkedAt: new Date().toISOString(),
				message,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}
}

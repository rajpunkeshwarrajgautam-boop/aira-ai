import { auth } from "@/auth";
import { isOmniRoutePreviewTestAccessEnabled } from "@/lib/omniroute-preview-access";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels, OmniRouteGatewayError } from "@services/omniroute/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
	if (!isOmniRoutePreviewTestAccessEnabled()) {
		const session = await auth();
		if (!session?.user?.id) {
			return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
		}
	}

	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		return Response.json(
			{ error: { code: "OMNIROUTE_NOT_CONFIGURED", message: config.configurationError ?? "OmniRoute is not configured." } },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}

	try {
		const snapshot = await fetchOmniRouteModels(req.signal);
		const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase().slice(0, 200) ?? "";
		const models = q
			? snapshot.models.filter((model) => `${model.id} ${model.ownedBy ?? ""}`.toLowerCase().includes(q))
			: snapshot.models;
		return Response.json(
			{
				models,
				total: snapshot.models.length,
				latencyMs: snapshot.latencyMs,
				checkedAt: snapshot.checkedAt,
				version: snapshot.version,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		const gatewayError = error instanceof OmniRouteGatewayError ? error : null;
		const status = gatewayError?.code === "OMNIROUTE_TIMEOUT" ? 504 : 502;
		return Response.json(
			{
				error: {
					code: gatewayError?.code ?? "OMNIROUTE_UNAVAILABLE",
					message: gatewayError?.message ?? "OmniRoute model discovery failed.",
				},
			},
			{ status, headers: { "Cache-Control": "no-store" } },
		);
	}
}

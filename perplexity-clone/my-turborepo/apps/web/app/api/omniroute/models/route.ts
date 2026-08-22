import { auth } from "@/auth";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels } from "@services/omniroute/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		return Response.json(
			{ error: { code: "OMNIROUTE_NOT_CONFIGURED", message: "OmniRoute is not configured." } },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}

	try {
		const snapshot = await fetchOmniRouteModels();
		const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
		const models = q
			? snapshot.models.filter((model) => `${model.id} ${model.ownedBy ?? ""}`.toLowerCase().includes(q))
			: snapshot.models;
		return Response.json(
			{ models, total: snapshot.models.length, latencyMs: snapshot.latencyMs },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		return Response.json(
			{
				error: {
					code: "OMNIROUTE_UNAVAILABLE",
					message: error instanceof Error ? error.message : "OmniRoute model discovery failed.",
				},
			},
			{ status: 502, headers: { "Cache-Control": "no-store" } },
		);
	}
}

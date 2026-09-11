import { auth } from "@/auth";
import { globalVerticalPackService, type VerticalPackId } from "@/lib/verticals/vertical-pack-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	return json({
		packs: globalVerticalPackService.listPacks(),
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { packId, inputPayload } = body;
		if (!packId) {
			return json({ error: { code: "BAD_REQUEST", message: "packId is required." } }, { status: 400 });
		}

		const result = globalVerticalPackService.executePackValidation(packId as VerticalPackId, inputPayload ?? {});
		return json({ result });
	} catch (error) {
		return json(
			{
				error: {
					code: "VERTICAL_PACK_ERROR",
					message: error instanceof Error ? error.message : "Vertical pack execution failed.",
				},
			},
			{ status: 500 },
		);
	}
}

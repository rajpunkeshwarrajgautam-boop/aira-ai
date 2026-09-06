import { auth } from "@/auth";
import { globalArtifactEngine } from "@/lib/artifacts/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const { id } = await context.params;
	const lineage = globalArtifactEngine.getProvenanceLineage(session.user.id, id);
	return json({ lineage });
}

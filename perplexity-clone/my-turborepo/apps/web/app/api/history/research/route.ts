import { auth } from "@/auth";
import { listResearchHistory } from "@/lib/conversation-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const url = new URL(req.url);
	const limit = Number(url.searchParams.get("limit") ?? "30");
	const history = await listResearchHistory(session.user.id, Number.isFinite(limit) ? limit : 30);
	return Response.json({ history });
}

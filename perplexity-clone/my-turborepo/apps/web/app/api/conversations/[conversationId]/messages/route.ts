import { auth } from "@/auth";
import { listConversationMessages } from "@/lib/conversation-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ conversationId: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { conversationId } = await params;
	const url = new URL(req.url);
	const limit = Number(url.searchParams.get("limit") ?? "100");
	try {
		const messages = await listConversationMessages(
			session.user.id,
			conversationId,
			Number.isFinite(limit) ? limit : 100,
		);
		return Response.json({ messages });
	} catch {
		return Response.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
	}
}

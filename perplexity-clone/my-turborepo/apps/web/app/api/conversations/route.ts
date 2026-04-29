import { z } from "zod";

import { auth } from "@/auth";
import { createConversation, listConversations } from "@/lib/conversation-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateConversationSchema = z.object({
	initialQuery: z.string().trim().min(1).max(16_000).optional(),
	title: z.string().trim().min(1).max(120).optional(),
});

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const url = new URL(req.url);
	const limit = Number(url.searchParams.get("limit") ?? "20");
	const rows = await listConversations(session.user.id, Number.isFinite(limit) ? limit : 20);
	return Response.json({ conversations: rows });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = CreateConversationSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: { code: "VALIDATION_ERROR", message: "Invalid request body.", details: z.treeifyError(parsed.error) } },
			{ status: 400 },
		);
	}
	const row = await createConversation(session.user.id, parsed.data.title ?? parsed.data.initialQuery);
	return Response.json({ conversation: row }, { status: 201 });
}

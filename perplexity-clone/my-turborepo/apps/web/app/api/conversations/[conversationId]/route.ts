import { z } from "zod";

import { auth } from "@/auth";
import { getConversationOrThrow } from "@/lib/conversation-memory";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
	title: z.string().trim().min(1).max(120).optional(),
	archived: z.boolean().optional(),
});

type Params = { params: Promise<{ conversationId: string }> };

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { conversationId } = await params;
	try {
		const row = await getConversationOrThrow(session.user.id, conversationId);
		return Response.json({ conversation: row });
	} catch {
		return Response.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
	}
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
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
	const parsed = UpdateSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: { code: "VALIDATION_ERROR", message: "Invalid request body.", details: z.treeifyError(parsed.error) } },
			{ status: 400 },
		);
	}
	const { conversationId } = await params;
	try {
		await getConversationOrThrow(session.user.id, conversationId);
		const updated = await prisma.conversation.update({
			where: { id: conversationId },
			data: {
				...(parsed.data.title ? { title: parsed.data.title } : {}),
				...(parsed.data.archived !== undefined
					? { archivedAt: parsed.data.archived ? new Date() : null }
					: {}),
			},
			select: { id: true, title: true, archivedAt: true, lastMessageAt: true, updatedAt: true },
		});
		return Response.json({ conversation: updated });
	} catch {
		return Response.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
	}
}

export async function DELETE(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const { conversationId } = await params;
	try {
		await getConversationOrThrow(session.user.id, conversationId);
		await prisma.conversation.update({
			where: { id: conversationId },
			data: { archivedAt: new Date() },
		});
		return new Response(null, { status: 204 });
	} catch {
		return Response.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
	}
}

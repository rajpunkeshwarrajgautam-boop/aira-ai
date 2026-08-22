import { z } from "zod";

import { auth } from "@/auth";
import { persistConversationTurn } from "@/lib/conversation-memory";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
	query: z.string().trim().min(1).max(20_000),
	answer: z.string().trim().min(1).max(60_000),
	conversationId: z.string().trim().min(1).max(200),
	parentMessageId: z.string().trim().min(1).max(200).optional(),
	model: z.string().trim().min(1).max(500),
});

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
	const parsed = Schema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid browser-local conversation turn." } }, { status: 400 });
	}

	await assertSafetyAllowed("input", parsed.data.query);
	await assertSafetyAllowed("output", parsed.data.answer);

	try {
		const persisted = await persistConversationTurn({
			userId: session.user.id,
			query: parsed.data.query,
			answer: parsed.data.answer,
			conversationId: parsed.data.conversationId,
			parentMessageId: parsed.data.parentMessageId,
			citations: [],
			exaSearchType: `browser-local:${parsed.data.model.slice(0, 180)}`,
		});
		return Response.json(persisted, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return Response.json(
			{
				error: {
					code: "LOCAL_TURN_PERSIST_FAILED",
					message: error instanceof Error ? error.message.slice(0, 500) : "Could not persist the local AIRA turn.",
				},
			},
			{ status: 500, headers: { "Cache-Control": "no-store" } },
		);
	}
}

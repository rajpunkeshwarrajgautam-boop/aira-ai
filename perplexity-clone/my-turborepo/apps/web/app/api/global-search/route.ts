import { auth } from "@/auth";
import { listConversations } from "@/lib/conversation-memory";
import { searchConversationMessages } from "@/lib/global-search";
import { listUserMemories } from "@/lib/persistent-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
	if (q.length < 2) return Response.json({ results: [] });
	const needle = q.toLowerCase();

	const [conversations, memories, messageMatches] = await Promise.all([
		listConversations(session.user.id, 40),
		listUserMemories(session.user.id, 100),
		searchConversationMessages(session.user.id, q, 40),
	]);

	const results: Array<Record<string, unknown>> = [];
	for (const conversation of conversations) {
		if (conversation.title.toLowerCase().includes(needle)) {
			results.push({
				type: "conversation",
				id: conversation.id,
				title: conversation.title,
				snippet: "Conversation title",
				updatedAt: conversation.lastMessageAt,
				href: `/?conversation=${encodeURIComponent(conversation.id)}`,
			});
		}
	}

	for (const memory of memories) {
		if (memory.content.toLowerCase().includes(needle)) {
			results.push({
				type: "memory",
				id: memory.id,
				title: memory.kind,
				snippet: memory.content,
				updatedAt: memory.updatedAt,
				href: `/memory?memory=${encodeURIComponent(memory.id)}`,
			});
		}
	}

	for (const message of messageMatches) {
		const lowerContent = message.content.toLowerCase();
		const pos = lowerContent.indexOf(needle);
		const start = Math.max(0, pos - 80);
		const snippet = message.content
			.slice(start, start + 260)
			.replace(/\s+/g, " ")
			.trim();
		results.push({
			type: "message",
			id: message.id,
			title: message.conversation.title,
			snippet,
			role: message.role,
			updatedAt: message.createdAt,
			href: `/?conversation=${encodeURIComponent(message.conversation.id)}`,
		});
	}

	return Response.json(
		{ results: results.slice(0, 60) },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

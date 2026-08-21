import { auth } from "@/auth";
import { listConversations, listConversationMessages } from "@/lib/conversation-memory";
import { listUserMemories } from "@/lib/persistent-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  const needle = q.toLowerCase();

  const [conversations, memories] = await Promise.all([
    listConversations(session.user.id, 40),
    listUserMemories(session.user.id, 100),
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
        href: "/memory",
      });
    }
  }

  const messageBatches = await Promise.allSettled(
    conversations.slice(0, 24).map(async (conversation) => ({
      conversation,
      messages: await listConversationMessages(session.user.id, conversation.id, 80),
    })),
  );

  for (const batch of messageBatches) {
    if (batch.status !== "fulfilled") continue;
    const { conversation, messages } = batch.value;
    for (const message of messages) {
      if (!message.content.toLowerCase().includes(needle)) continue;
      const pos = message.content.toLowerCase().indexOf(needle);
      const start = Math.max(0, pos - 80);
      const snippet = message.content.slice(start, start + 260).replace(/\s+/g, " ").trim();
      results.push({
        type: "message",
        id: message.id,
        title: conversation.title,
        snippet,
        role: message.role,
        updatedAt: message.createdAt,
        href: `/?conversation=${encodeURIComponent(conversation.id)}`,
      });
      if (results.length >= 60) break;
    }
    if (results.length >= 60) break;
  }

  return Response.json({ results: results.slice(0, 60) }, { headers: { "Cache-Control": "no-store" } });
}

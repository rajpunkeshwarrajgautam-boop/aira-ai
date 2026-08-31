import { auth } from "@/auth";
import { listConversations, listConversationMessages } from "@/lib/conversation-memory";
import { listKnowledgeAssets } from "@/lib/knowledge-assets";
import { listUserMemories } from "@/lib/persistent-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceSearchResult = {
  readonly type: "conversation" | "message" | "memory" | "knowledge";
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly role?: string;
  readonly status?: string;
  readonly updatedAt?: string;
  readonly href: string;
};

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

  const [conversations, memories, knowledge] = await Promise.all([
    listConversations(session.user.id, 40),
    listUserMemories(session.user.id, 100),
    process.env.MULTIMODAL_INGESTION_ENABLED === "true"
      ? listKnowledgeAssets(session.user.id, 100).catch(() => [])
      : Promise.resolve([]),
  ]);

  const results: WorkspaceSearchResult[] = [];

  for (const conversation of conversations) {
    if (!conversation.title.toLowerCase().includes(needle)) continue;
    results.push({
      type: "conversation",
      id: conversation.id,
      title: conversation.title,
      snippet: "Saved conversation",
      updatedAt: conversation.lastMessageAt,
      href: `/?conversation=${encodeURIComponent(conversation.id)}`,
    });
  }

  for (const memory of memories) {
    if (!memory.content.toLowerCase().includes(needle)) continue;
    results.push({
      type: "memory",
      id: memory.id,
      title: memory.kind,
      snippet: memory.content,
      updatedAt: memory.updatedAt,
      href: `/memory?memory=${encodeURIComponent(memory.id)}`,
    });
  }

  for (const asset of knowledge) {
    if (!asset.filename.toLowerCase().includes(needle) && !asset.mimeType.toLowerCase().includes(needle)) continue;
    results.push({
      type: "knowledge",
      id: asset.id,
      title: asset.filename,
      snippet: `${asset.mimeType} · ${asset.status.toLowerCase()} knowledge asset`,
      status: asset.status,
      updatedAt: asset.updatedAt.toISOString(),
      href: `/knowledge?asset=${encodeURIComponent(asset.id)}`,
    });
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
      const normalizedContent = message.content.toLowerCase();
      if (!normalizedContent.includes(needle)) continue;
      const pos = normalizedContent.indexOf(needle);
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
      if (results.length >= 80) break;
    }
    if (results.length >= 80) break;
  }

  results.sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });

  return Response.json(
    { results: results.slice(0, 80) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

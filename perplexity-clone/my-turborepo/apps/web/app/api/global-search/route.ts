import { auth } from "@/auth";
import { listConversations } from "@/lib/conversation-memory";
import { searchConversationMessages } from "@/lib/global-search";
import { listUserMemories } from "@/lib/persistent-memory";
import { globalArtifactEngine } from "@/lib/artifacts/engine";
import { listKnowledgeAssets } from "@/lib/knowledge-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResult = {
  type: "conversation" | "message" | "memory" | "project" | "artifact" | "knowledge";
  id: string; title: string; snippet: string; role?: string; updatedAt?: string | Date; href: string;
};

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  const needle = q.toLowerCase();
  const projectSearch = import("@/lib/agent-platform/store")
    .then((store) => store.listProjects(session.user.id))
    .catch(() => []);
  const [conversations, memories, messageMatches, projects, artifacts, knowledgeAssets] = await Promise.all([
    listConversations(session.user.id, 40),
    listUserMemories(session.user.id, 100),
    searchConversationMessages(session.user.id, q, 40),
    projectSearch,
    globalArtifactEngine.listArtifactsAsync(session.user.id).catch(() => []),
    listKnowledgeAssets(session.user.id, 60).catch(() => []),
  ]);
  const results: SearchResult[] = [];
  for (const conversation of conversations) if (conversation.title.toLowerCase().includes(needle)) results.push({ type: "conversation", id: conversation.id, title: conversation.title, snippet: "Conversation title", updatedAt: conversation.lastMessageAt, href: `/?conversation=${encodeURIComponent(conversation.id)}` });
  for (const memory of memories) if (memory.content.toLowerCase().includes(needle)) results.push({ type: "memory", id: memory.id, title: memory.kind, snippet: memory.content, updatedAt: memory.updatedAt, href: `/memory?memory=${encodeURIComponent(memory.id)}` });
  for (const message of messageMatches) {
    const pos = message.content.toLowerCase().indexOf(needle); const start = Math.max(0, pos - 80);
    results.push({ type: "message", id: message.id, title: message.conversation.title, snippet: message.content.slice(start, start + 260).replace(/\s+/g, " ").trim(), role: message.role, updatedAt: message.createdAt, href: `/?conversation=${encodeURIComponent(message.conversation.id)}` });
  }
  for (const project of projects) if (`${project.name} ${project.objective}`.toLowerCase().includes(needle)) results.push({ type: "project", id: project.id, title: project.name, snippet: project.objective, updatedAt: project.updatedAt, href: `/projects?project=${encodeURIComponent(project.id)}` });
  for (const artifact of artifacts) {
    const tags = Array.isArray(artifact.tags) ? artifact.tags.join(" ") : "";
    if (`${artifact.name} ${artifact.format} ${tags}`.toLowerCase().includes(needle)) results.push({ type: "artifact", id: artifact.id, title: artifact.name, snippet: `${artifact.format} · version ${artifact.currentVersion}`, updatedAt: artifact.updatedAt, href: `/artifacts?artifact=${encodeURIComponent(artifact.id)}` });
  }
  for (const asset of knowledgeAssets) if (`${asset.filename} ${asset.mimeType} ${asset.status}`.toLowerCase().includes(needle)) results.push({ type: "knowledge", id: asset.id, title: asset.filename, snippet: `${asset.mimeType} · ${asset.status}`, updatedAt: asset.updatedAt, href: `/knowledge?asset=${encodeURIComponent(asset.id)}` });
  results.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return Response.json({ results: results.slice(0, 80) }, { headers: { "Cache-Control": "no-store" } });
}
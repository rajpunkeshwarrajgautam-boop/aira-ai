import { auth } from "@/auth";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await context.params;
  const agent = await globalUserAgentStore.getAgentAsync(session.user.id, id);
  if (!agent || agent.userId !== session.user.id) return Response.json({ error: { code: "NOT_FOUND", message: "Agent not found." } }, { status: 404 });
  const versions = await globalUserAgentStore.getAgentVersionsAsync(session.user.id, id);
  return Response.json({ versions }, { headers: { "Cache-Control": "no-store" } });
}

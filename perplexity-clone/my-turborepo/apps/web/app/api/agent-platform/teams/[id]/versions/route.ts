import { auth } from "@/auth";
import { getAgentTeam, listAgentTeamVersions } from "@/lib/agent-platform/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await context.params;
  const team = await getAgentTeam(session.user.id, id);
  if (!team) return json({ error: { code: "NOT_FOUND", message: "Agent Team not found." } }, { status: 404 });
  return json({ versions: await listAgentTeamVersions(session.user.id, id) });
}

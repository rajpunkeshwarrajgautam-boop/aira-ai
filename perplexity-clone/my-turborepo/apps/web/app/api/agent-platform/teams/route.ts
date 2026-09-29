import { auth } from "@/auth";
import { AgentTeamDefinitionSchema, createAgentTeam, listAgentTeams } from "@/lib/agent-platform/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  return json({ teams: await listAgentTeams(session.user.id) });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const parsed = AgentTeamDefinitionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid Agent Team definition.", details: parsed.error.format() } }, { status: 400 });
  }
  try {
    const team = await createAgentTeam(session.user.id, parsed.data);
    return json({ team }, { status: 201 });
  } catch (error) {
    return json({ error: { code: "TEAM_INVALID", message: error instanceof Error ? error.message : "Agent Team could not be created." } }, { status: 400 });
  }
}

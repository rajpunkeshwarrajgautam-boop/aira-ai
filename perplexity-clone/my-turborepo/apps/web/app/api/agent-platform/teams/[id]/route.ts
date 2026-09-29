import { auth } from "@/auth";
import { AgentTeamDefinitionSchema, archiveAgentTeam, getAgentTeam, updateAgentTeam } from "@/lib/agent-platform/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await params;
  const team = await getAgentTeam(session.user.id, id);
  if (!team) return json({ error: { code: "NOT_FOUND", message: "Agent Team not found." } }, { status: 404 });
  return json({ team });
}

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await params;
  const parsed = AgentTeamDefinitionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid Agent Team definition.", details: parsed.error.format() } }, { status: 400 });
  }
  try {
    const team = await updateAgentTeam(session.user.id, id, parsed.data);
    if (!team) return json({ error: { code: "NOT_FOUND", message: "Agent Team not found." } }, { status: 404 });
    return json({ team });
  } catch (error) {
    return json({ error: { code: "TEAM_INVALID", message: error instanceof Error ? error.message : "Agent Team could not be saved." } }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { id } = await params;
  const archived = await archiveAgentTeam(session.user.id, id);
  if (!archived) return json({ error: { code: "NOT_FOUND", message: "Agent Team not found." } }, { status: 404 });
  return json({ archived: true });
}

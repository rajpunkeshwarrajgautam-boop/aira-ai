import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };
type ProjectRow = {
  id: string;
  userId: string;
  name: string;
  objective: string;
  status: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const PatchProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  objective: z.string().trim().min(3).max(8000).optional(),
}).refine((value) => value.name !== undefined || value.objective !== undefined, {
  message: "Provide a project name or objective to update.",
});

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

async function ownerProject(userId: string, projectId: string): Promise<ProjectRow | null> {
  const rows = await prisma.$queryRaw<ProjectRow[]>`
    select * from "AgentProject"
    where "id"=${projectId} and "userId"=${userId} and "status"='ACTIVE'
    limit 1
  `;
  return rows[0] ?? null;
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { projectId } = await params;
  const project = await ownerProject(session.user.id, projectId);
  if (!project) return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  return json({ project });
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = PatchProjectSchema.safeParse(body);
  if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Invalid project update.", details: z.treeifyError(parsed.error) } }, { status: 400 });
  const { projectId } = await params;
  const current = await ownerProject(session.user.id, projectId);
  if (!current) return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  const name = parsed.data.name ?? current.name;
  const objective = parsed.data.objective ?? current.objective;
  const rows = await prisma.$queryRaw<ProjectRow[]>`
    update "AgentProject"
    set "name"=${name}, "objective"=${objective}, "updatedAt"=current_timestamp
    where "id"=${projectId} and "userId"=${session.user.id} and "status"='ACTIVE'
    returning *
  `;
  if (!rows[0]) return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  return json({ project: rows[0] });
}

export async function DELETE(_: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
  const { projectId } = await params;
  const changed = await prisma.$executeRaw`
    update "AgentProject"
    set "status"='ARCHIVED', "updatedAt"=current_timestamp
    where "id"=${projectId} and "userId"=${session.user.id} and "status"='ACTIVE'
  `;
  if (changed !== 1) return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  return json({ archived: true });
}

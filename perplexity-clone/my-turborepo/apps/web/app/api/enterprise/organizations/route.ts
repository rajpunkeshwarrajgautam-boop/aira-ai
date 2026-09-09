import { z } from "zod";
import { auth } from "@/auth";
import { globalEnterpriseOrgManager } from "@/lib/enterprise/organization-manager";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

type GovernanceRow = { orgId: string; orgName: string; slug: string; role: string; workspaceId: string | null; workspaceName: string | null };
type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
const ROLE_RANK: Record<OrganizationRole, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

const CreateOrgSchema = z.object({ action: z.literal("create_org"), name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/) });
const CreateWorkspaceSchema = z.object({ action: z.literal("create_workspace"), orgId: z.string().min(1), name: z.string().trim().min(2).max(100), budgetLimitUsd: z.number().min(0).optional(), allowedToolIds: z.array(z.string()).optional() });
const ShareSchema = z.object({ action: z.literal("share_agent"), agentId: z.string().min(1), workspaceId: z.string().min(1), permission: z.enum(["USE", "EDIT", "ADMIN"]) });

async function hasOrganizationRole(orgId: string, userId: string, requiredRole: OrganizationRole): Promise<boolean> {
  // The durable database is authoritative for access. Never fall back to an
  // in-memory membership after a membership has been revoked from PostgreSQL.
  const membership = await prisma.enterpriseMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });
  if (!membership) return false;
  const role = membership.role as OrganizationRole;
  return ROLE_RANK[role] >= ROLE_RANK[requiredRole];
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
  const rows = await prisma.$queryRaw<GovernanceRow[]>`
    select o.id as "orgId", o.name as "orgName", o.slug, m.role,
           w.id as "workspaceId", w.name as "workspaceName"
    from "EnterpriseMembership" m
    join "EnterpriseOrganization" o on o.id = m."orgId"
    left join "EnterpriseWorkspace" w on w."orgId" = o.id
    where m."userId" = ${session.user.id}
    order by o.name asc, w.name asc nulls last
  `;
  const organizations = Array.from(new Set(rows.map((row) => row.orgId))).map((orgId) => {
    const first = rows.find((row) => row.orgId === orgId)!;
    return { id: orgId, name: first.orgName, slug: first.slug, role: first.role, workspaces: rows.filter((row) => row.orgId === orgId && row.workspaceId).map((row) => ({ id: row.workspaceId!, name: row.workspaceName! })) };
  });
  return json({ organizations, enterpriseSso: { state: "EXTERNAL_BLOCKED", detail: "A live corporate SAML/OIDC IdP is required for Gate 113 certification." } });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json({ error: { code: "BAD_REQUEST", message: "Invalid governance action." } }, { status: 400 });
  try {
    if ((raw as { action?: string }).action === "create_org") {
      const parsed = CreateOrgSchema.parse(raw);
      const org = await globalEnterpriseOrgManager.createOrganizationAsync({ name: parsed.name, slug: parsed.slug, ownerUserId: session.user.id });
      return json({ org }, { status: 201 });
    }
    if ((raw as { action?: string }).action === "create_workspace") {
      const parsed = CreateWorkspaceSchema.parse(raw);
      if (!(await hasOrganizationRole(parsed.orgId, session.user.id, "ADMIN"))) return json({ error: { code: "FORBIDDEN", message: "Requires ADMIN role." } }, { status: 403 });
      const workspace = await globalEnterpriseOrgManager.createWorkspaceAsync({ orgId: parsed.orgId, name: parsed.name, budgetLimitUsd: parsed.budgetLimitUsd, allowedToolIds: parsed.allowedToolIds });
      return json({ workspace }, { status: 201 });
    }
    if ((raw as { action?: string }).action === "share_agent") {
      const parsed = ShareSchema.parse(raw);
      const workspace = await prisma.enterpriseWorkspace.findUnique({ where: { id: parsed.workspaceId }, select: { id: true, orgId: true } });
      if (!workspace) return json({ error: { code: "NOT_FOUND", message: "Workspace not found." } }, { status: 404 });
      if (!(await hasOrganizationRole(workspace.orgId, session.user.id, "ADMIN"))) return json({ error: { code: "FORBIDDEN", message: "Requires ADMIN role in the workspace organization." } }, { status: 403 });
      const agent = await globalUserAgentStore.getAgentAsync(session.user.id, parsed.agentId);
      if (!agent || agent.userId !== session.user.id) return json({ error: { code: "NOT_FOUND", message: "Agent not found." } }, { status: 404 });
      const accessLevel = parsed.permission === "ADMIN" ? "MANAGE" : parsed.permission === "EDIT" ? "EXECUTE" : "READ";
      const shares = [...agent.shares.filter((share) => share.workspaceId !== workspace.id), { workspaceId: workspace.id, accessLevel }] as typeof agent.shares;
      const updated = await globalUserAgentStore.updateAgentAsync(session.user.id, agent.id, { shares });
      if (!updated) return json({ error: { code: "NOT_FOUND", message: "Agent not found." } }, { status: 404 });
      return json({ shared: true, agentId: agent.id, workspaceId: workspace.id, accessLevel });
    }
    return json({ error: { code: "BAD_REQUEST", message: "Unknown governance action." } }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: { code: "VALIDATION_ERROR", message: "Invalid governance action.", details: z.treeifyError(error) } }, { status: 400 });
    console.error("[enterprise:organizations] action failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: { code: "ORGANIZATION_ACTION_FAILED", message: "Organization action failed." } }, { status: 500 });
  }
}

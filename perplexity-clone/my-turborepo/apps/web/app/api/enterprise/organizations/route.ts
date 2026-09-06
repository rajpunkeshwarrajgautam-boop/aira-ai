import { auth } from "@/auth";
import { globalEnterpriseOrgManager } from "@/lib/enterprise/organization-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { action } = body;

		if (action === "create_org") {
			const { name, slug, ssoConfig, securityPolicy } = body;
			const org = globalEnterpriseOrgManager.createOrganization({
				name,
				slug,
				ownerUserId: session.user.id,
				ssoConfig,
				securityPolicy,
			});
			return json({ org }, { status: 201 });
		}

		if (action === "create_workspace") {
			const { orgId, name, budgetLimitUsd, allowedToolIds } = body;
			const isAuthorized = globalEnterpriseOrgManager.canPerformAction(orgId, session.user.id, "ADMIN");
			if (!isAuthorized) {
				return json({ error: { code: "FORBIDDEN", message: "Requires ADMIN role." } }, { status: 403 });
			}
			const workspace = globalEnterpriseOrgManager.createWorkspace({
				orgId,
				name,
				budgetLimitUsd,
				allowedToolIds,
			});
			return json({ workspace }, { status: 201 });
		}

		if (action === "share_agent") {
			const { agentId, workspaceId, permission } = body;
			globalEnterpriseOrgManager.shareAgentWithWorkspace({
				agentId,
				workspaceId,
				permission,
				sharedByUserId: session.user.id,
				sharedAt: new Date().toISOString(),
			});
			return json({ shared: true });
		}

		return json({ error: { code: "BAD_REQUEST", message: `Unknown action: ${action}` } }, { status: 400 });
	} catch (error) {
		return json(
			{
				error: {
					code: "ORGANIZATION_ACTION_FAILED",
					message: error instanceof Error ? error.message : "Action failed.",
				},
			},
			{ status: 500 },
		);
	}
}

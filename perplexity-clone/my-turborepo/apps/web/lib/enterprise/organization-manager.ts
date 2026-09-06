import { z } from "zod";

export type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export const OrganizationSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(128),
	slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
	ownerUserId: z.string().min(1),
	ssoConfig: z
		.object({
			enabled: z.boolean().default(false),
			provider: z.enum(["SAML", "OIDC"]).default("SAML"),
			idpMetadataUrl: z.string().url().optional(),
			domainHint: z.string().optional(),
		})
		.default({ enabled: false, provider: "SAML" }),
	securityPolicy: z
		.object({
			enforceMfa: z.boolean().default(false),
			sessionTimeoutMinutes: z.number().int().min(15).default(1440),
			ipAllowlist: z.array(z.string()).default([]),
		})
		.default({ enforceMfa: false, sessionTimeoutMinutes: 1440, ipAllowlist: [] }),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const WorkspaceSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	name: z.string().min(1).max(128),
	budgetLimitUsd: z.number().nonnegative().default(100.0),
	allowedToolIds: z.array(z.string()).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const OrganizationMembershipSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	userId: z.string().min(1),
	role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
	joinedAt: z.string(),
});

export const TeamAgentShareSchema = z.object({
	agentId: z.string().min(1),
	workspaceId: z.string().min(1),
	permission: z.enum(["USE", "EDIT", "ADMIN"]),
	sharedByUserId: z.string().min(1),
	sharedAt: z.string(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;
export type TeamAgentShare = z.infer<typeof TeamAgentShareSchema>;

export class EnterpriseOrganizationManager {
	private orgs = new Map<string, Organization>();
	private workspaces = new Map<string, Workspace>();
	private memberships = new Map<string, OrganizationMembership[]>(); // orgId -> members
	private agentShares = new Map<string, TeamAgentShare[]>(); // workspaceId -> shares

	createOrganization(input: {
		name: string;
		slug: string;
		ownerUserId: string;
		ssoConfig?: Partial<Organization["ssoConfig"]>;
		securityPolicy?: Partial<Organization["securityPolicy"]>;
	}): Organization {
		const id = `org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const now = new Date().toISOString();
		const org: Organization = OrganizationSchema.parse({
			...input,
			id,
			ssoConfig: { enabled: false, provider: "SAML", ...(input.ssoConfig ?? {}) },
			securityPolicy: { enforceMfa: false, sessionTimeoutMinutes: 1440, ipAllowlist: [], ...(input.securityPolicy ?? {}) },
			createdAt: now,
			updatedAt: now,
		});

		this.orgs.set(org.id, org);

		// Owner membership
		const membership: OrganizationMembership = {
			id: `mem-${Date.now()}`,
			orgId: org.id,
			userId: input.ownerUserId,
			role: "OWNER",
			joinedAt: now,
		};
		this.memberships.set(org.id, [membership]);

		return org;
	}

	createWorkspace(input: { orgId: string; name: string; budgetLimitUsd?: number; allowedToolIds?: string[] }): Workspace {
		const org = this.orgs.get(input.orgId);
		if (!org) throw new Error("Organization not found");

		const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const now = new Date().toISOString();
		const ws: Workspace = WorkspaceSchema.parse({
			id,
			orgId: input.orgId,
			name: input.name,
			budgetLimitUsd: input.budgetLimitUsd ?? 100.0,
			allowedToolIds: input.allowedToolIds ?? [],
			createdAt: now,
			updatedAt: now,
		});

		this.workspaces.set(ws.id, ws);
		return ws;
	}

	shareAgentWithWorkspace(share: TeamAgentShare): void {
		const validated = TeamAgentShareSchema.parse(share);
		const current = this.agentShares.get(validated.workspaceId) ?? [];
		current.push(validated);
		this.agentShares.set(validated.workspaceId, current);
	}

	listWorkspaceAgents(workspaceId: string): readonly TeamAgentShare[] {
		return this.agentShares.get(workspaceId) ?? [];
	}

	getMemberRole(orgId: string, userId: string): OrganizationRole | null {
		const members = this.memberships.get(orgId) ?? [];
		const mem = members.find((m) => m.userId === userId);
		return mem ? mem.role : null;
	}

	canPerformAction(orgId: string, userId: string, requiredRole: OrganizationRole): boolean {
		const role = this.getMemberRole(orgId, userId);
		if (!role) return false;
		const hierarchy: Record<OrganizationRole, number> = {
			VIEWER: 0,
			MEMBER: 1,
			ADMIN: 2,
			OWNER: 3,
		};
		return hierarchy[role] >= hierarchy[requiredRole];
	}
}

export const globalEnterpriseOrgManager = new EnterpriseOrganizationManager();

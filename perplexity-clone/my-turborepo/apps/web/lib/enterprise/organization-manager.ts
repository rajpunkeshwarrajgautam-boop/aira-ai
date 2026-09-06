import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const OrganizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const OrganizationSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(2).max(100),
	slug: z.string().min(2).max(64),
	ownerUserId: z.string().min(1),
	ssoConfig: z.object({
		enabled: z.boolean().default(false),
		provider: z.enum(["SAML", "OIDC"]).default("SAML"),
		idpMetadataUrl: z.string().optional(),
		domain: z.string().optional(),
		domainHint: z.string().optional(),
	}).default({ enabled: false, provider: "SAML" }),
	securityPolicy: z.object({
		enforceMfa: z.boolean().default(false),
		sessionTimeoutMinutes: z.number().int().positive().default(1440),
		ipAllowlist: z.array(z.string()).default([]),
	}).default({ enforceMfa: false, sessionTimeoutMinutes: 1440, ipAllowlist: [] }),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const WorkspaceSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	name: z.string().min(2).max(100),
	budgetLimitUsd: z.number().min(0).default(100.0),
	allowedToolIds: z.array(z.string()).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const OrganizationMembershipSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	userId: z.string().min(1),
	role: OrganizationRoleSchema.default("MEMBER"),
	joinedAt: z.string(),
});

export const TeamAgentShareSchema = z.object({
	workspaceId: z.string().min(1),
	agentId: z.string().min(1),
	permission: z.enum(["USE", "EDIT", "ADMIN"]),
	sharedByUserId: z.string().min(1),
	sharedAt: z.string(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;
export type TeamAgentShare = z.infer<typeof TeamAgentShareSchema>;

export class EnterpriseOrganizationManager {
	private readonly storeDir: string;
	private readonly dataPath: string;

	private orgs = new Map<string, Organization>();
	private workspaces = new Map<string, Workspace>();
	private memberships = new Map<string, OrganizationMembership[]>(); // orgId -> members
	private agentShares = new Map<string, TeamAgentShare[]>(); // workspaceId -> shares

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.dataPath = join(this.storeDir, "enterprise-orgs.json");
		this.ensureStorageDir();
		this.loadFromDisk();
	}

	private ensureStorageDir(): void {
		try {
			if (!existsSync(this.storeDir)) {
				mkdirSync(this.storeDir, { recursive: true });
			}
		} catch {
			// fallback
		}
	}

	private loadFromDisk(): void {
		try {
			if (existsSync(this.dataPath)) {
				const raw = readFileSync(this.dataPath, "utf8");
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") {
					if (Array.isArray(parsed.orgs)) {
						for (const o of parsed.orgs) this.orgs.set(o.id, o);
					}
					if (Array.isArray(parsed.workspaces)) {
						for (const w of parsed.workspaces) this.workspaces.set(w.id, w);
					}
					if (parsed.memberships && typeof parsed.memberships === "object") {
						for (const [k, v] of Object.entries(parsed.memberships)) {
							if (Array.isArray(v)) this.memberships.set(k, v as OrganizationMembership[]);
						}
					}
					if (parsed.agentShares && typeof parsed.agentShares === "object") {
						for (const [k, v] of Object.entries(parsed.agentShares)) {
							if (Array.isArray(v)) this.agentShares.set(k, v as TeamAgentShare[]);
						}
					}
				}
			}
		} catch {
			// fail-safe read
		}
	}

	private persistToDisk(): void {
		try {
			this.ensureStorageDir();
			const payload = {
				orgs: [...this.orgs.values()],
				workspaces: [...this.workspaces.values()],
				memberships: Object.fromEntries(this.memberships.entries()),
				agentShares: Object.fromEntries(this.agentShares.entries()),
			};
			const temp = `${this.dataPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
			renameSync(temp, this.dataPath);
		} catch {
			// fail-safe write
		}
	}

	private async syncOrgToDb(org: Organization): Promise<void> {
		if (!process.env.DATABASE_URL) return;
		try {
			await prisma.enterpriseOrganization.upsert({
				where: { id: org.id },
				create: {
					id: org.id,
					name: org.name,
					slug: org.slug,
					ssoConfig: org.ssoConfig as never,
				},
				update: {
					name: org.name,
					slug: org.slug,
					ssoConfig: org.ssoConfig as never,
				},
			});
		} catch {
			// Non-blocking
		}
	}

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
		this.persistToDisk();
		void this.syncOrgToDb(org);

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
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.enterpriseWorkspace.create({
				data: { id: ws.id, orgId: ws.orgId, name: ws.name },
			}).catch(() => null);
		}

		return ws;
	}

	shareAgentWithWorkspace(share: TeamAgentShare): void {
		const validated = TeamAgentShareSchema.parse(share);
		const current = this.agentShares.get(validated.workspaceId) ?? [];
		const filtered = current.filter((s) => s.agentId !== validated.agentId);
		filtered.push(validated);
		this.agentShares.set(validated.workspaceId, filtered);
		this.persistToDisk();
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

	reloadFromDisk(): void {
		this.orgs.clear();
		this.workspaces.clear();
		this.memberships.clear();
		this.agentShares.clear();
		this.loadFromDisk();
	}
}

export const globalEnterpriseOrgManager = new EnterpriseOrganizationManager();

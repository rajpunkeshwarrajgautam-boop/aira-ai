import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const OrganizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

const ROLE_RANK: Record<OrganizationRole, number> = {
	OWNER: 4,
	ADMIN: 3,
	MEMBER: 2,
	VIEWER: 1,
};

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
	private readonly orgsPath: string;
	private readonly workspacesPath: string;
	private readonly membershipsPath: string;
	private readonly sharesPath: string;

	private memoryOrgs = new Map<string, Organization>();
	private memoryWorkspaces = new Map<string, Workspace>();
	private memoryMemberships = new Map<string, OrganizationMembership>();
	private memoryAgentShares = new Map<string, TeamAgentShare>();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.orgsPath = join(this.storeDir, "enterprise-orgs.json");
		this.workspacesPath = join(this.storeDir, "enterprise-workspaces.json");
		this.membershipsPath = join(this.storeDir, "enterprise-memberships.json");
		this.sharesPath = join(this.storeDir, "enterprise-shares.json");

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
			if (existsSync(this.orgsPath)) {
				const raw = readFileSync(this.orgsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const o of parsed) this.memoryOrgs.set(o.id, o);
				}
			}
			if (existsSync(this.workspacesPath)) {
				const raw = readFileSync(this.workspacesPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const w of parsed) this.memoryWorkspaces.set(w.id, w);
				}
			}
			if (existsSync(this.membershipsPath)) {
				const raw = readFileSync(this.membershipsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const m of parsed) this.memoryMemberships.set(m.id, m);
				}
			}
			if (existsSync(this.sharesPath)) {
				const raw = readFileSync(this.sharesPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const s of parsed) this.memoryAgentShares.set(`${s.workspaceId}:${s.agentId}`, s);
				}
			}
		} catch {
			// fail-safe read
		}
	}

	private persistToDisk(): void {
		try {
			this.ensureStorageDir();
			const orgsArr = [...this.memoryOrgs.values()];
			const tempO = `${this.orgsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempO, JSON.stringify(orgsArr, null, 2), "utf8");
			renameSync(tempO, this.orgsPath);

			const wsArr = [...this.memoryWorkspaces.values()];
			const tempW = `${this.workspacesPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempW, JSON.stringify(wsArr, null, 2), "utf8");
			renameSync(tempW, this.workspacesPath);

			const memArr = [...this.memoryMemberships.values()];
			const tempM = `${this.membershipsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempM, JSON.stringify(memArr, null, 2), "utf8");
			renameSync(tempM, this.membershipsPath);

			const sharesArr = [...this.memoryAgentShares.values()];
			const tempS = `${this.sharesPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempS, JSON.stringify(sharesArr, null, 2), "utf8");
			renameSync(tempS, this.sharesPath);
		} catch {
			// fail-safe write
		}
	}

	createOrganization(input: {
		name: string;
		slug: string;
		ownerUserId: string;
		ssoConfig?: Partial<Organization["ssoConfig"]>;
		securityPolicy?: Partial<Organization["securityPolicy"]>;
	}): Organization {
		const id = `org-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();

		const org: Organization = {
			id,
			name: input.name,
			slug: input.slug,
			ownerUserId: input.ownerUserId,
			ssoConfig: {
				enabled: input.ssoConfig?.enabled ?? false,
				provider: input.ssoConfig?.provider ?? "SAML",
				idpMetadataUrl: input.ssoConfig?.idpMetadataUrl,
				domain: input.ssoConfig?.domain,
				domainHint: input.ssoConfig?.domainHint,
			},
			securityPolicy: {
				enforceMfa: input.securityPolicy?.enforceMfa ?? false,
				sessionTimeoutMinutes: input.securityPolicy?.sessionTimeoutMinutes ?? 1440,
				ipAllowlist: input.securityPolicy?.ipAllowlist ?? [],
			},
			createdAt: now,
			updatedAt: now,
		};
		const validated = OrganizationSchema.parse(org);
		this.memoryOrgs.set(id, validated);

		// Automatically add owner membership
		const memId = `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		this.memoryMemberships.set(memId, {
			id: memId,
			orgId: id,
			userId: input.ownerUserId,
			role: "OWNER",
			joinedAt: now,
		});

		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.$transaction(async (tx) => {
				await tx.enterpriseOrganization.create({
					data: {
						id: validated.id,
						name: validated.name,
						slug: validated.slug,
						ssoConfig: validated.ssoConfig,
					},
				});
				await tx.enterpriseMembership.create({
					data: {
						id: memId,
						orgId: validated.id,
						userId: validated.ownerUserId,
						role: "OWNER",
					},
				});
			}).catch(() => null);
		}

		return validated;
	}

	async createOrganizationAsync(input: {
		name: string;
		slug: string;
		ownerUserId: string;
		ssoConfig?: Partial<Organization["ssoConfig"]>;
		securityPolicy?: Partial<Organization["securityPolicy"]>;
	}): Promise<Organization> {
		const id = `org-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();

		const org: Organization = {
			id,
			name: input.name,
			slug: input.slug,
			ownerUserId: input.ownerUserId,
			ssoConfig: {
				enabled: input.ssoConfig?.enabled ?? false,
				provider: input.ssoConfig?.provider ?? "SAML",
				idpMetadataUrl: input.ssoConfig?.idpMetadataUrl,
				domain: input.ssoConfig?.domain,
				domainHint: input.ssoConfig?.domainHint,
			},
			securityPolicy: {
				enforceMfa: input.securityPolicy?.enforceMfa ?? false,
				sessionTimeoutMinutes: input.securityPolicy?.sessionTimeoutMinutes ?? 1440,
				ipAllowlist: input.securityPolicy?.ipAllowlist ?? [],
			},
			createdAt: now,
			updatedAt: now,
		};
		const validated = OrganizationSchema.parse(org);
		const memId = `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

		if (process.env.DATABASE_URL) {
			await prisma.$transaction(async (tx) => {
				await tx.enterpriseOrganization.create({
					data: {
						id: validated.id,
						name: validated.name,
						slug: validated.slug,
						ssoConfig: validated.ssoConfig,
					},
				});
				await tx.enterpriseMembership.create({
					data: {
						id: memId,
						orgId: validated.id,
						userId: validated.ownerUserId,
						role: "OWNER",
					},
				});
			});
		}

		this.memoryOrgs.set(id, validated);
		this.memoryMemberships.set(memId, {
			id: memId,
			orgId: id,
			userId: input.ownerUserId,
			role: "OWNER",
			joinedAt: now,
		});
		this.persistToDisk();

		return validated;
	}

	getMemberRole(orgId: string, userId: string): OrganizationRole | null {
		const org = this.memoryOrgs.get(orgId);
		if (org?.ownerUserId === userId) return "OWNER";
		for (const m of this.memoryMemberships.values()) {
			if (m.orgId === orgId && m.userId === userId) {
				return m.role;
			}
		}
		return null;
	}

	async getMemberRoleAsync(orgId: string, userId: string): Promise<OrganizationRole | null> {
		if (process.env.DATABASE_URL) {
			const member = await prisma.enterpriseMembership.findUnique({
				where: { orgId_userId: { orgId, userId } },
			});
			if (member) return member.role as OrganizationRole;
		}
		return this.getMemberRole(orgId, userId);
	}

	canPerformAction(orgId: string, userId: string, requiredRole: OrganizationRole): boolean {
		const userRole = this.getMemberRole(orgId, userId);
		if (!userRole) return false;
		return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
	}

	async canPerformActionAsync(orgId: string, userId: string, requiredRole: OrganizationRole): Promise<boolean> {
		const userRole = await this.getMemberRoleAsync(orgId, userId);
		if (!userRole) return false;
		return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
	}

	createWorkspace(input: {
		orgId: string;
		name: string;
		budgetLimitUsd?: number;
		allowedToolIds?: string[];
	}): Workspace {
		const id = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();

		const ws: Workspace = {
			id,
			orgId: input.orgId,
			name: input.name,
			budgetLimitUsd: input.budgetLimitUsd ?? 100.0,
			allowedToolIds: input.allowedToolIds ?? [],
			createdAt: now,
			updatedAt: now,
		};
		const validated = WorkspaceSchema.parse(ws);
		this.memoryWorkspaces.set(id, validated);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.enterpriseWorkspace.create({
				data: {
					id: validated.id,
					orgId: validated.orgId,
					name: validated.name,
				},
			}).catch(() => null);
		}

		return validated;
	}

	async createWorkspaceAsync(input: {
		orgId: string;
		name: string;
		budgetLimitUsd?: number;
		allowedToolIds?: string[];
	}): Promise<Workspace> {
		const id = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();

		const ws: Workspace = {
			id,
			orgId: input.orgId,
			name: input.name,
			budgetLimitUsd: input.budgetLimitUsd ?? 100.0,
			allowedToolIds: input.allowedToolIds ?? [],
			createdAt: now,
			updatedAt: now,
		};
		const validated = WorkspaceSchema.parse(ws);

		if (process.env.DATABASE_URL) {
			await prisma.enterpriseWorkspace.create({
				data: {
					id: validated.id,
					orgId: validated.orgId,
					name: validated.name,
				},
			});
		}

		this.memoryWorkspaces.set(id, validated);
		this.persistToDisk();
		return validated;
	}

	shareAgentWithWorkspace(share: TeamAgentShare): void {
		const validated = TeamAgentShareSchema.parse(share);
		this.memoryAgentShares.set(`${validated.workspaceId}:${validated.agentId}`, validated);
		this.persistToDisk();
	}

	listWorkspaceAgents(workspaceId: string): readonly TeamAgentShare[] {
		return [...this.memoryAgentShares.values()].filter((s) => s.workspaceId === workspaceId);
	}

	getOrganization(id: string): Organization | null {
		return this.memoryOrgs.get(id) ?? null;
	}

	async getOrganizationAsync(id: string): Promise<Organization | null> {
		if (process.env.DATABASE_URL) {
			const row = await prisma.enterpriseOrganization.findUnique({
				where: { id },
				include: { members: { where: { role: "OWNER" }, take: 1 } },
			});
			if (!row) return null;
			const sso = (row.ssoConfig ?? {}) as Record<string, unknown>;
			return OrganizationSchema.parse({
				id: row.id,
				name: row.name,
				slug: row.slug,
				ownerUserId: row.members[0]?.userId ?? "unknown",
				ssoConfig: {
					enabled: Boolean(sso.enabled),
					provider: sso.provider === "OIDC" ? "OIDC" : "SAML",
					idpMetadataUrl: sso.idpMetadataUrl ? String(sso.idpMetadataUrl) : undefined,
					domain: sso.domain ? String(sso.domain) : undefined,
					domainHint: sso.domainHint ? String(sso.domainHint) : undefined,
				},
				securityPolicy: {
					enforceMfa: false,
					sessionTimeoutMinutes: 1440,
					ipAllowlist: [],
				},
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.createdAt.toISOString(),
			});
		}
		return this.memoryOrgs.get(id) ?? null;
	}

	reloadFromDisk(): void {
		this.memoryOrgs.clear();
		this.memoryWorkspaces.clear();
		this.memoryMemberships.clear();
		this.memoryAgentShares.clear();
		this.loadFromDisk();
	}

	clearMemoryCache(): void {
		this.memoryOrgs.clear();
		this.memoryWorkspaces.clear();
		this.memoryMemberships.clear();
		this.memoryAgentShares.clear();
	}
}

export const globalOrganizationManager = new EnterpriseOrganizationManager();
export const globalEnterpriseOrgManager = globalOrganizationManager;

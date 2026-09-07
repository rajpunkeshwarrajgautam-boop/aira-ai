import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const InstallableSkillSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(2).max(80),
	description: z.string().max(300),
	instructions: z.string().min(1).max(5000),
	requiredTools: z.array(z.string()).default([]),
	preferredRoles: z.array(z.string()).default([]),
	keywords: z.array(z.string()).default([]),
	permissions: z.array(z.string()).default([]),
	version: z.string().regex(/^\d+\.\d+\.\d+$/).default("1.0.0"),
	enabled: z.boolean().default(true),
	isBuiltin: z.boolean().default(false),
	author: z.string().default("AIRA Platform"),
	workspaceId: z.string().optional(),
	userId: z.string().optional(),
	evaluationScore: z.number().min(0).max(100).default(85),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type InstallableSkill = z.infer<typeof InstallableSkillSchema>;

export interface InstallSkillInput {
	readonly name: string;
	readonly description: string;
	readonly instructions: string;
	readonly requiredTools?: readonly string[] | string[];
	readonly preferredRoles?: readonly string[] | string[];
	readonly keywords?: readonly string[] | string[];
	readonly permissions?: readonly string[] | string[];
	readonly version?: string;
	readonly enabled?: boolean;
	readonly author?: string;
	readonly workspaceId?: string;
	readonly userId?: string;
	readonly evaluationScore?: number;
	readonly id?: string;
}

export class InstallableSkillsStore {
	private readonly storeDir: string;
	private readonly skillsPath: string;
	private builtinMap = new Map<string, InstallableSkill>();
	private memorySkills = new Map<string, InstallableSkill>();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.skillsPath = join(this.storeDir, "installable-skills.json");
		this.ensureStorageDir();
		this.registerBuiltins();
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
			if (existsSync(this.skillsPath)) {
				const raw = readFileSync(this.skillsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const s of parsed) {
						if (s && typeof s === "object" && typeof s.id === "string") {
							this.memorySkills.set(s.id, s as InstallableSkill);
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
			const skillsArr = [...this.memorySkills.values()];
			const tempS = `${this.skillsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempS, JSON.stringify(skillsArr, null, 2), "utf8");
			renameSync(tempS, this.skillsPath);
		} catch {
			// fail-safe write
		}
	}

	private registerBuiltins(): void {
		const now = new Date().toISOString();
		const builtins: Array<Omit<InstallableSkill, "createdAt" | "updatedAt">> = [
			{
				id: "research",
				name: "Deep Web Research",
				description: "Grounded multi-source web investigations with citations",
				instructions: "Synthesize findings across authoritative domains with dates and source URLs.",
				requiredTools: ["web", "files"],
				preferredRoles: ["RESEARCH"],
				keywords: ["search", "gather", "investigate", "source"],
				permissions: ["web:search", "files:read"],
				version: "2.0.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 98,
			},
			{
				id: "frontend-design",
				name: "Modern Frontend Craft",
				description: "Polished Tailwind, CSS grid, and accessible React interfaces",
				instructions: "Build accessible, responsive components with micro-interactions and dark mode parity.",
				requiredTools: ["files", "terminal"],
				preferredRoles: ["FRONTEND", "UI_UX"],
				keywords: ["ui", "react", "component", "tailwind", "responsive"],
				permissions: ["files:read", "files:write"],
				version: "2.1.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 96,
			},
			{
				id: "backend-architecture",
				name: "Distributed Systems & DB",
				description: "Postgres schema design, query optimization, and resilient APIs",
				instructions: "Ensure schema migrations are backward-compatible, indexed, and zero-downtime.",
				requiredTools: ["files", "terminal", "supabase"],
				preferredRoles: ["BACKEND", "ARCHITECT"],
				keywords: ["database", "sql", "migration", "api", "backend"],
				permissions: ["files:read", "files:write", "supabase:read"],
				version: "2.0.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 97,
			},
			{
				id: "qa-testing",
				name: "Agentic Test Architecture",
				description: "Deterministic unit, integration, and E2E regression suites",
				instructions: "Write behavioral specifications and assert failure modes with hermetic test isolation.",
				requiredTools: ["files", "terminal"],
				preferredRoles: ["QA", "FULLSTACK"],
				keywords: ["test", "tdd", "assert", "regression", "qa"],
				permissions: ["files:read", "files:write", "terminal:exec"],
				version: "1.9.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 95,
			},
			{
				id: "security-audit",
				name: "OWASP Threat Modeler",
				description: "Static code analysis, authorization bypass checks, and credential protection",
				instructions: "Audit tool permissions, sanitize input prompts, and prevent privilege escalation.",
				requiredTools: ["files", "terminal"],
				preferredRoles: ["SECURITY", "ARCHITECT"],
				keywords: ["security", "owasp", "vulnerability", "auth", "audit"],
				permissions: ["files:read"],
				version: "2.2.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 99,
			},
			{
				id: "cloud-devops",
				name: "Container & CI/CD Operator",
				description: "Docker pipelines, Kubernetes manifests, and cloud telemetry",
				instructions: "Automate containerized build matrices with verifiable health checks and rollout gates.",
				requiredTools: ["files", "terminal"],
				preferredRoles: ["DEVOPS", "PLATFORM"],
				keywords: ["docker", "k8s", "ci", "pipeline", "deploy"],
				permissions: ["files:read", "files:write", "terminal:exec"],
				version: "2.0.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 94,
			},
		];

		for (const b of builtins) {
			this.builtinMap.set(b.id, {
				...b,
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	installSkill(
		userIdOrInput: string | InstallSkillInput,
		maybeInput?: InstallSkillInput,
	): InstallableSkill {
		let userId: string | undefined;
		let input: InstallSkillInput;

		if (typeof userIdOrInput === "string") {
			userId = userIdOrInput;
			input = maybeInput!;
		} else {
			input = userIdOrInput;
		}

		const id = input.id ?? `skill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const skill: InstallableSkill = {
			name: input.name,
			description: input.description,
			instructions: input.instructions,
			requiredTools: input.requiredTools ? [...input.requiredTools] : [],
			preferredRoles: input.preferredRoles ? [...input.preferredRoles] : [],
			keywords: input.keywords ? [...input.keywords] : [],
			permissions: input.permissions ? [...input.permissions] : [],
			version: input.version ?? "1.0.0",
			enabled: input.enabled ?? true,
			author: input.author ?? "AIRA Platform",
			workspaceId: input.workspaceId,
			evaluationScore: input.evaluationScore ?? 85,
			userId: userId ?? input.userId,
			id,
			isBuiltin: false,
			createdAt: now,
			updatedAt: now,
		};
		const validated = InstallableSkillSchema.parse(skill);
		this.memorySkills.set(id, validated);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.installableSkill.upsert({
				where: { id: validated.id },
				create: {
					id: validated.id,
					name: validated.name,
					version: validated.version,
					description: validated.description,
					author: validated.author,
					workspaceId: validated.workspaceId,
					userId: validated.userId,
					enabled: validated.enabled,
					permissions: validated.permissions,
					tools: validated.requiredTools,
					manifest: {
						instructions: validated.instructions,
						preferredRoles: validated.preferredRoles,
						keywords: validated.keywords,
						evaluationScore: validated.evaluationScore,
					},
					isBuiltin: false,
				},
				update: {
					name: validated.name,
					version: validated.version,
					description: validated.description,
					enabled: validated.enabled,
					permissions: validated.permissions,
					tools: validated.requiredTools,
				},
			}).catch(() => null);
		}

		return validated;
	}

	async installSkillAsync(
		userIdOrInput: string | InstallSkillInput,
		maybeInput?: InstallSkillInput,
	): Promise<InstallableSkill> {
		let userId: string | undefined;
		let input: InstallSkillInput;

		if (typeof userIdOrInput === "string") {
			userId = userIdOrInput;
			input = maybeInput!;
		} else {
			input = userIdOrInput;
		}

		const id = input.id ?? `skill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const skill: InstallableSkill = {
			name: input.name,
			description: input.description,
			instructions: input.instructions,
			requiredTools: input.requiredTools ? [...input.requiredTools] : [],
			preferredRoles: input.preferredRoles ? [...input.preferredRoles] : [],
			keywords: input.keywords ? [...input.keywords] : [],
			permissions: input.permissions ? [...input.permissions] : [],
			version: input.version ?? "1.0.0",
			enabled: input.enabled ?? true,
			author: input.author ?? "AIRA Platform",
			workspaceId: input.workspaceId,
			evaluationScore: input.evaluationScore ?? 85,
			userId: userId ?? input.userId,
			id,
			isBuiltin: false,
			createdAt: now,
			updatedAt: now,
		};
		const validated = InstallableSkillSchema.parse(skill);

		if (process.env.DATABASE_URL) {
			await prisma.installableSkill.create({
				data: {
					id: validated.id,
					name: validated.name,
					version: validated.version,
					description: validated.description,
					author: validated.author,
					workspaceId: validated.workspaceId,
					userId: validated.userId,
					enabled: validated.enabled,
					permissions: validated.permissions,
					tools: validated.requiredTools,
					manifest: {
						instructions: validated.instructions,
						preferredRoles: validated.preferredRoles,
						keywords: validated.keywords,
						evaluationScore: validated.evaluationScore,
					},
					isBuiltin: false,
				},
			});
		}

		this.memorySkills.set(id, validated);
		this.persistToDisk();
		return validated;
	}

	getSkill(id: string): InstallableSkill | null {
		const builtin = this.builtinMap.get(id);
		if (builtin) return builtin;
		return this.memorySkills.get(id) ?? null;
	}

	async getSkillAsync(id: string): Promise<InstallableSkill | null> {
		const builtin = this.builtinMap.get(id);
		if (builtin) return builtin;

		if (process.env.DATABASE_URL) {
			const dbSkill = await prisma.installableSkill.findUnique({
				where: { id },
			});
			if (!dbSkill) return null;
			const manifest = (dbSkill.manifest ?? {}) as Record<string, unknown>;
			return InstallableSkillSchema.parse({
				id: dbSkill.id,
				userId: dbSkill.userId ?? undefined,
				workspaceId: dbSkill.workspaceId ?? undefined,
				name: dbSkill.name,
				description: dbSkill.description,
				instructions: String(manifest.instructions ?? ""),
				requiredTools: dbSkill.tools,
				preferredRoles: Array.isArray(manifest.preferredRoles) ? manifest.preferredRoles : [],
				keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
				permissions: dbSkill.permissions,
				version: dbSkill.version,
				enabled: dbSkill.enabled,
				isBuiltin: dbSkill.isBuiltin,
				author: dbSkill.author,
				evaluationScore: typeof manifest.evaluationScore === "number" ? manifest.evaluationScore : 85,
				createdAt: dbSkill.createdAt.toISOString(),
				updatedAt: dbSkill.updatedAt.toISOString(),
			});
		}

		return this.memorySkills.get(id) ?? null;
	}

	listSkills(scope?: string | { userId?: string; workspaceId?: string }): readonly InstallableSkill[] {
		const filter = typeof scope === "string" ? { userId: scope } : scope;
		const builtins = [...this.builtinMap.values()];
		const customs = [...this.memorySkills.values()].filter((s) => {
			if (filter?.userId && s.userId !== filter.userId) return false;
			if (filter?.workspaceId && s.workspaceId !== filter.workspaceId) return false;
			return true;
		});
		return [...builtins, ...customs];
	}

	async listSkillsAsync(scope?: string | { userId?: string; workspaceId?: string }): Promise<readonly InstallableSkill[]> {
		const filter = typeof scope === "string" ? { userId: scope } : scope;
		const builtins = [...this.builtinMap.values()];

		if (process.env.DATABASE_URL) {
			const whereClause: Record<string, unknown> = {};
			if (filter?.userId) whereClause.userId = filter.userId;
			if (filter?.workspaceId) whereClause.workspaceId = filter.workspaceId;

			const dbSkills = await prisma.installableSkill.findMany({
				where: whereClause,
				orderBy: { updatedAt: "desc" },
			});

			const mapped = dbSkills.map((s) => {
				const manifest = (s.manifest ?? {}) as Record<string, unknown>;
				return InstallableSkillSchema.parse({
					id: s.id,
					userId: s.userId ?? undefined,
					workspaceId: s.workspaceId ?? undefined,
					name: s.name,
					description: s.description,
					instructions: String(manifest.instructions ?? ""),
					requiredTools: s.tools,
					preferredRoles: Array.isArray(manifest.preferredRoles) ? manifest.preferredRoles : [],
					keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
					permissions: s.permissions,
					version: s.version,
					enabled: s.enabled,
					isBuiltin: s.isBuiltin,
					author: s.author,
					evaluationScore: typeof manifest.evaluationScore === "number" ? manifest.evaluationScore : 85,
					createdAt: s.createdAt.toISOString(),
					updatedAt: s.updatedAt.toISOString(),
				});
			});

			return [...builtins, ...mapped];
		}

		return this.listSkills(filter);
	}

	toggleSkill(id: string, enabled: boolean): boolean {
		const s = this.memorySkills.get(id);
		if (!s) return false;
		(s as { enabled: boolean }).enabled = enabled;
		this.persistToDisk();
		if (process.env.DATABASE_URL) {
			void prisma.installableSkill.update({
				where: { id },
				data: { enabled },
			}).catch(() => null);
		}
		return true;
	}

	async toggleSkillAsync(id: string, enabled: boolean): Promise<boolean> {
		if (process.env.DATABASE_URL) {
			await prisma.installableSkill.update({
				where: { id },
				data: { enabled },
			});
		}
		const s = this.memorySkills.get(id);
		if (s) (s as { enabled: boolean }).enabled = enabled;
		this.persistToDisk();
		return true;
	}

	uninstallSkill(userIdOrId: string, maybeSkillId?: string): boolean {
		const skillId = maybeSkillId ?? userIdOrId;
		const deleted = this.memorySkills.delete(skillId);
		this.persistToDisk();
		if (process.env.DATABASE_URL) {
			void prisma.installableSkill.delete({ where: { id: skillId } }).catch(() => null);
		}
		return deleted;
	}

	async uninstallSkillAsync(userIdOrId: string, maybeSkillId?: string): Promise<boolean> {
		const skillId = maybeSkillId ?? userIdOrId;
		if (process.env.DATABASE_URL) {
			await prisma.installableSkill.delete({ where: { id: skillId } });
		}
		const deleted = this.memorySkills.delete(skillId);
		this.persistToDisk();
		return deleted;
	}

	clearMemoryCache(): void {
		this.memorySkills.clear();
	}

	reloadFromDisk(): void {
		this.memorySkills.clear();
		this.registerBuiltins();
		this.loadFromDisk();
	}
}

export const globalSkillsStore = new InstallableSkillsStore();

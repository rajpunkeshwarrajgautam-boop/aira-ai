import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BUILTIN_SKILLS } from "../aira-runtime/skills";
import { prisma } from "@/lib/prisma";

export const InstallableSkillSchema = z.object({
	id: z.string().min(1),
	userId: z.string().optional(), // optional if system/builtin
	workspaceId: z.string().optional(),
	name: z.string().min(1).max(80),
	description: z.string().max(400),
	instructions: z.string().min(1).max(10_000),
	requiredTools: z.array(z.string()).default([]),
	preferredRoles: z.array(z.string()).default([]),
	keywords: z.array(z.string()).default([]),
	permissions: z.array(z.string()).default([]),
	version: z.string().default("1.0.0"),
	enabled: z.boolean().default(true),
	isBuiltin: z.boolean().default(false),
	author: z.string().default("community"),
	evaluationScore: z.number().min(0).max(100).default(85),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type InstallableSkill = z.infer<typeof InstallableSkillSchema>;

export class InstallableSkillsStore {
	private readonly storeDir: string;
	private readonly dataFilePath: string;
	private skills = new Map<string, InstallableSkill>();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.dataFilePath = join(this.storeDir, "installable-skills.json");
		this.ensureStorageDir();
		this.initializeBuiltins();
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

	private initializeBuiltins(): void {
		const now = new Date().toISOString();
		for (const b of BUILTIN_SKILLS) {
			this.skills.set(b.id, {
				id: b.id,
				name: b.name,
				description: b.description,
				instructions: b.instructions,
				requiredTools: [...b.requiredTools],
				preferredRoles: [...b.preferredRoles],
				keywords: [...b.keywords],
				permissions: [],
				version: "1.0.0",
				enabled: true,
				isBuiltin: true,
				author: "AIRA Platform",
				evaluationScore: 95,
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	private loadFromDisk(): void {
		try {
			if (existsSync(this.dataFilePath)) {
				const raw = readFileSync(this.dataFilePath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const item of parsed) {
						const res = InstallableSkillSchema.safeParse(item);
						if (res.success && !res.data.isBuiltin) {
							this.skills.set(res.data.id, res.data);
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
			// Only persist user-installed (non-builtin) skills
			const userSkills = [...this.skills.values()].filter((s) => !s.isBuiltin);
			const tempFile = `${this.dataFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempFile, JSON.stringify(userSkills, null, 2), "utf8");
			renameSync(tempFile, this.dataFilePath);
		} catch {
			// fail-safe write
		}
	}

	private async syncToDatabase(skill: InstallableSkill, isDelete = false): Promise<void> {
		if (!process.env.DATABASE_URL) return;
		try {
			if (isDelete) {
				await prisma.installableSkill.delete({ where: { id: skill.id } }).catch(() => null);
				return;
			}
			await prisma.installableSkill.upsert({
				where: { id: skill.id },
				create: {
					id: skill.id,
					name: skill.name,
					version: skill.version,
					description: skill.description,
					author: skill.author,
					workspaceId: skill.workspaceId ?? null,
					userId: skill.userId ?? null,
					enabled: skill.enabled,
					permissions: skill.permissions,
					tools: skill.requiredTools,
					manifest: {
						instructions: skill.instructions,
						preferredRoles: skill.preferredRoles,
						keywords: skill.keywords,
						evaluationScore: skill.evaluationScore,
					},
					isBuiltin: skill.isBuiltin,
				},
				update: {
					name: skill.name,
					version: skill.version,
					description: skill.description,
					enabled: skill.enabled,
					permissions: skill.permissions,
					tools: skill.requiredTools,
					manifest: {
						instructions: skill.instructions,
						preferredRoles: skill.preferredRoles,
						keywords: skill.keywords,
						evaluationScore: skill.evaluationScore,
					},
				},
			}).catch(() => null);
		} catch {
			// Non-blocking
		}
	}

	validateSkill(input: unknown): { valid: boolean; errors: string[] } {
		const res = InstallableSkillSchema.safeParse(input);
		if (!res.success) {
			return {
				valid: false,
				errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
			};
		}
		return { valid: true, errors: [] };
	}

	installSkill(
		userId: string,
		input: Omit<InstallableSkill, "id" | "isBuiltin" | "createdAt" | "updatedAt" | "evaluationScore"> & {
			evaluationScore?: number;
		},
	): InstallableSkill {
		const id = `skill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const skill: InstallableSkill = {
			...input,
			evaluationScore: input.evaluationScore ?? 85,
			id,
			userId,
			isBuiltin: false,
			createdAt: now,
			updatedAt: now,
		};
		const validated = InstallableSkillSchema.parse(skill);
		this.skills.set(id, validated);
		this.persistToDisk();
		void this.syncToDatabase(validated);
		return validated;
	}

	getSkill(id: string): InstallableSkill | null {
		return this.skills.get(id) ?? null;
	}

	listSkills(userId?: string, workspaceId?: string): readonly InstallableSkill[] {
		return [...this.skills.values()].filter((s) => {
			if (s.isBuiltin) return true;
			if (workspaceId && s.workspaceId === workspaceId) return true;
			if (userId && s.userId === userId) return true;
			return false;
		});
	}

	toggleSkill(id: string, enabled: boolean): boolean {
		const skill = this.skills.get(id);
		if (!skill) return false;
		const updated: InstallableSkill = {
			...skill,
			enabled,
			updatedAt: new Date().toISOString(),
		};
		this.skills.set(id, updated);
		this.persistToDisk();
		void this.syncToDatabase(updated);
		return true;
	}

	updateSkill(
		userId: string,
		id: string,
		updates: Partial<Omit<InstallableSkill, "id" | "userId" | "isBuiltin" | "createdAt">>,
	): InstallableSkill | null {
		const existing = this.skills.get(id);
		if (!existing || existing.isBuiltin || existing.userId !== userId) return null;
		const updated: InstallableSkill = {
			...existing,
			...updates,
			updatedAt: new Date().toISOString(),
		};
		const validated = InstallableSkillSchema.parse(updated);
		this.skills.set(id, validated);
		this.persistToDisk();
		void this.syncToDatabase(validated);
		return validated;
	}

	uninstallSkill(userId: string, id: string): boolean {
		const skill = this.skills.get(id);
		if (!skill || skill.isBuiltin || skill.userId !== userId) return false;
		const deleted = this.skills.delete(id);
		this.persistToDisk();
		void this.syncToDatabase(skill, true);
		return deleted;
	}

	// For tests: simulate server restart
	reloadFromDisk(): void {
		this.skills.clear();
		this.initializeBuiltins();
		this.loadFromDisk();
	}
}

export const globalSkillsStore = new InstallableSkillsStore();

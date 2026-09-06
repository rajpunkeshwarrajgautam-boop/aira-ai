import { z } from "zod";
import { BUILTIN_SKILLS, type RuntimeSkill } from "../aira-runtime/skills";

export const InstallableSkillSchema = z.object({
	id: z.string().min(1),
	userId: z.string().optional(), // optional if system/builtin
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
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type InstallableSkill = z.infer<typeof InstallableSkillSchema>;

class InstallableSkillsStore {
	private skills = new Map<string, InstallableSkill>();

	constructor() {
		// Populate built-in skills
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
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	installSkill(userId: string, input: Omit<InstallableSkill, "id" | "isBuiltin" | "createdAt" | "updatedAt">): InstallableSkill {
		const id = `skill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const skill: InstallableSkill = {
			...input,
			id,
			userId,
			isBuiltin: false,
			createdAt: now,
			updatedAt: now,
		};
		const validated = InstallableSkillSchema.parse(skill);
		this.skills.set(id, validated);
		return validated;
	}

	getSkill(id: string): InstallableSkill | null {
		return this.skills.get(id) ?? null;
	}

	listSkills(userId?: string): readonly InstallableSkill[] {
		return [...this.skills.values()].filter((s) => s.isBuiltin || (userId && s.userId === userId));
	}

	toggleSkill(id: string, enabled: boolean): boolean {
		const skill = this.skills.get(id);
		if (!skill) return false;
		this.skills.set(id, {
			...skill,
			enabled,
			updatedAt: new Date().toISOString(),
		});
		return true;
	}

	uninstallSkill(userId: string, id: string): boolean {
		const skill = this.skills.get(id);
		if (!skill || skill.isBuiltin || skill.userId !== userId) return false;
		return this.skills.delete(id);
	}
}

export const globalSkillsStore = new InstallableSkillsStore();

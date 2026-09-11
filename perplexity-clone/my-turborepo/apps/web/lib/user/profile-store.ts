import { z } from "zod";

export const UserProfileConfigSchema = z.object({
	userId: z.string().min(1),
	displayName: z.string().max(80).optional(),
	customInstructions: z.string().max(4000).default(""),
	responseStyle: z.enum(["CONCISE", "BALANCED", "DETAILED", "ACADEMIC"]).default("BALANCED"),
	defaultEffort: z.enum(["LOW", "MEDIUM", "HIGH", "MAXIMUM"]).default("MEDIUM"),
	autoApproveSafeTools: z.boolean().default(true),
	privacyMode: z.enum(["STANDARD", "STRICT", "EPHEMERAL"]).default("STANDARD"),
	updatedAt: z.string(),
});

export type UserProfileConfig = z.infer<typeof UserProfileConfigSchema>;

class UserProfileStore {
	private configs = new Map<string, UserProfileConfig>();

	getProfile(userId: string): UserProfileConfig {
		const existing = this.configs.get(userId);
		if (existing) return existing;

		const defaultProfile: UserProfileConfig = {
			userId,
			customInstructions: "",
			responseStyle: "BALANCED",
			defaultEffort: "MEDIUM",
			autoApproveSafeTools: true,
			privacyMode: "STANDARD",
			updatedAt: new Date().toISOString(),
		};
		this.configs.set(userId, defaultProfile);
		return defaultProfile;
	}

	updateProfile(userId: string, updates: Partial<Omit<UserProfileConfig, "userId" | "updatedAt">>): UserProfileConfig {
		const current = this.getProfile(userId);
		const updated: UserProfileConfig = {
			...current,
			...updates,
			updatedAt: new Date().toISOString(),
		};
		const validated = UserProfileConfigSchema.parse(updated);
		this.configs.set(userId, validated);
		return validated;
	}
}

export const globalUserProfileStore = new UserProfileStore();

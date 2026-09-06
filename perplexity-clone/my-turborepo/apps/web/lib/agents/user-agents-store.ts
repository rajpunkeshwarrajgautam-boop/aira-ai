import { z } from "zod";

export const UserAgentSchema = z.object({
	id: z.string().min(1),
	userId: z.string().min(1),
	name: z.string().min(1).max(80),
	description: z.string().max(300),
	instructions: z.string().min(1).max(10_000),
	modelPolicy: z.object({
		provider: z.enum(["AUTO", "OMNIROUTE", "NVIDIA", "OPENAI", "DEERFLOW", "AUTOGPT"]).default("AUTO"),
		modelId: z.string().optional(),
		temperature: z.number().min(0).max(2).default(0.7),
		maxTokens: z.number().positive().default(4096),
	}),
	tools: z.array(z.string()).default([]),
	skills: z.array(z.string()).default([]),
	memoryPolicy: z.object({
		enabled: z.boolean().default(true),
		scope: z.enum(["GLOBAL", "PROJECT", "SESSION"]).default("PROJECT"),
	}).default({ enabled: true, scope: "PROJECT" }),
	budget: z.object({
		maxCostUsd: z.number().min(0).default(10),
		maxDurationMinutes: z.number().positive().default(30),
	}).default({ maxCostUsd: 10, maxDurationMinutes: 30 }),
	riskPolicy: z.object({
		requireApprovalAbove: z.enum(["LOW", "MEDIUM", "HIGH", "PROTECTED"]).default("MEDIUM"),
	}).default({ requireApprovalAbove: "MEDIUM" }),
	avatar: z.string().optional(),
	version: z.number().int().positive().default(1),
	isPublic: z.boolean().default(false),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type UserAgent = z.infer<typeof UserAgentSchema>;

class UserAgentStore {
	private agents = new Map<string, UserAgent>();

	createAgent(userId: string, input: Omit<UserAgent, "id" | "userId" | "version" | "createdAt" | "updatedAt">): UserAgent {
		const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const agent: UserAgent = {
			...input,
			id,
			userId,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const validated = UserAgentSchema.parse(agent);
		this.agents.set(id, validated);
		return validated;
	}

	getAgent(userId: string, agentId: string): UserAgent | null {
		const agent = this.agents.get(agentId);
		if (!agent) return null;
		if (agent.userId !== userId && !agent.isPublic) return null;
		return agent;
	}

	listAgents(userId: string): readonly UserAgent[] {
		return [...this.agents.values()].filter((a) => a.userId === userId || a.isPublic);
	}

	updateAgent(userId: string, agentId: string, updates: Partial<Omit<UserAgent, "id" | "userId" | "createdAt">>): UserAgent | null {
		const existing = this.agents.get(agentId);
		if (!existing || existing.userId !== userId) return null;

		const updated: UserAgent = {
			...existing,
			...updates,
			version: existing.version + 1,
			updatedAt: new Date().toISOString(),
		};
		const validated = UserAgentSchema.parse(updated);
		this.agents.set(agentId, validated);
		return validated;
	}

	deleteAgent(userId: string, agentId: string): boolean {
		const existing = this.agents.get(agentId);
		if (!existing || existing.userId !== userId) return false;
		return this.agents.delete(agentId);
	}
}

export const globalUserAgentStore = new UserAgentStore();

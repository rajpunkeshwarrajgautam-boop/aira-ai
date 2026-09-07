import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

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
	connectors: z.array(z.string()).default([]),
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
	avatar: z.string().nullish().transform((value) => value ?? undefined),
	version: z.number().int().positive().default(1),
	isPublic: z.boolean().default(false),
	shares: z.array(z.object({
		workspaceId: z.string(),
		accessLevel: z.enum(["READ", "EXECUTE", "MANAGE"]),
	})).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type UserAgent = z.infer<typeof UserAgentSchema>;

export interface AgentVersionRecord {
	readonly agentId: string;
	readonly version: number;
	readonly instructions: string;
	readonly tools: readonly string[];
	readonly skills: readonly string[];
	readonly connectors?: readonly string[];
	readonly modelPolicy: UserAgent["modelPolicy"];
	readonly shares?: readonly { workspaceId: string; accessLevel: "READ" | "EXECUTE" | "MANAGE" }[];
	readonly createdAt: string;
}

export class UserAgentStore {
	private readonly storeDir: string;
	private readonly agentsPath: string;
	private readonly versionsPath: string;

	private agents = new Map<string, UserAgent>();
	private versions = new Map<string, AgentVersionRecord[]>();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.agentsPath = join(this.storeDir, "user-agents.json");
		this.versionsPath = join(this.storeDir, "agent-versions.json");

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
			if (existsSync(this.agentsPath)) {
				const raw = readFileSync(this.agentsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const a of parsed) this.agents.set(a.id, a);
				}
			}
			if (existsSync(this.versionsPath)) {
				const raw = readFileSync(this.versionsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (typeof parsed === "object" && parsed !== null) {
					for (const [k, v] of Object.entries(parsed)) {
						if (Array.isArray(v)) this.versions.set(k, v as AgentVersionRecord[]);
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
			const agentsArr = [...this.agents.values()];
			const tempA = `${this.agentsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempA, JSON.stringify(agentsArr, null, 2), "utf8");
			renameSync(tempA, this.agentsPath);

			const verObj = Object.fromEntries(this.versions.entries());
			const tempV = `${this.versionsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempV, JSON.stringify(verObj, null, 2), "utf8");
			renameSync(tempV, this.versionsPath);
		} catch {
			// fail-safe write
		}
	}

	private recordVersion(agent: UserAgent): void {
		const record: AgentVersionRecord = {
			agentId: agent.id,
			version: agent.version,
			instructions: agent.instructions,
			tools: [...agent.tools],
			skills: [...agent.skills],
			connectors: [...agent.connectors],
			modelPolicy: { ...agent.modelPolicy },
			shares: [...agent.shares],
			createdAt: new Date().toISOString(),
		};
		const existing = this.versions.get(agent.id) ?? [];
		existing.push(record);
		this.versions.set(agent.id, existing);
	}

	createAgent(
		userId: string,
		input: Omit<UserAgent, "id" | "userId" | "version" | "createdAt" | "updatedAt" | "connectors" | "shares"> & {
			connectors?: readonly string[];
			shares?: readonly { workspaceId: string; accessLevel: "READ" | "EXECUTE" | "MANAGE" }[];
		},
	): UserAgent {
		const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const agent: UserAgent = {
			...input,
			connectors: input.connectors ? [...input.connectors] : [],
			shares: input.shares ? [...input.shares] : [],
			id,
			userId,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const validated = UserAgentSchema.parse(agent);
		this.agents.set(id, validated);
		this.recordVersion(validated);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.$transaction(async (tx) => {
				await tx.userAgent.create({
					data: {
						id: validated.id,
						userId: validated.userId,
						name: validated.name,
						description: validated.description,
						instructions: validated.instructions,
						modelPolicy: validated.modelPolicy,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						memoryPolicy: validated.memoryPolicy,
						budget: validated.budget,
						riskPolicy: validated.riskPolicy,
						avatar: validated.avatar,
						version: validated.version,
						isPublic: validated.isPublic,
						shares: validated.shares as never,
					},
				});
				await tx.userAgentVersion.create({
					data: {
						agentId: validated.id,
						version: validated.version,
						instructions: validated.instructions,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						modelPolicy: validated.modelPolicy,
						shares: validated.shares as never,
					},
				});
			}).catch(() => null);
		}

		return validated;
	}

	async createAgentAsync(
		userId: string,
		input: Omit<UserAgent, "id" | "userId" | "version" | "createdAt" | "updatedAt" | "connectors" | "shares"> & {
			connectors?: readonly string[];
			shares?: readonly { workspaceId: string; accessLevel: "READ" | "EXECUTE" | "MANAGE" }[];
		},
	): Promise<UserAgent> {
		const id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const agent: UserAgent = {
			...input,
			connectors: input.connectors ? [...input.connectors] : [],
			shares: input.shares ? [...input.shares] : [],
			id,
			userId,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const validated = UserAgentSchema.parse(agent);

		if (process.env.DATABASE_URL) {
			await prisma.$transaction(async (tx) => {
				await tx.userAgent.create({
					data: {
						id: validated.id,
						userId: validated.userId,
						name: validated.name,
						description: validated.description,
						instructions: validated.instructions,
						modelPolicy: validated.modelPolicy,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						memoryPolicy: validated.memoryPolicy,
						budget: validated.budget,
						riskPolicy: validated.riskPolicy,
						avatar: validated.avatar,
						version: validated.version,
						isPublic: validated.isPublic,
						shares: validated.shares as never,
					},
				});
				await tx.userAgentVersion.create({
					data: {
						agentId: validated.id,
						version: validated.version,
						instructions: validated.instructions,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						modelPolicy: validated.modelPolicy,
						shares: validated.shares as never,
					},
				});
			});
		}

		this.agents.set(id, validated);
		this.recordVersion(validated);
		this.persistToDisk();

		return validated;
	}

	getAgent(userId: string, agentId: string): UserAgent | null {
		const agent = this.agents.get(agentId);
		if (!agent) return null;
		if (agent.userId !== userId && !agent.isPublic) return null;
		return agent;
	}

	async getAgentAsync(userId: string, agentId: string): Promise<UserAgent | null> {
		if (process.env.DATABASE_URL) {
			const dbAgent = await prisma.userAgent.findFirst({
				where: {
					id: agentId,
					OR: [{ userId }, { isPublic: true }],
				},
			});
			if (!dbAgent) return null;
			return UserAgentSchema.parse({
				...dbAgent,
				createdAt: dbAgent.createdAt.toISOString(),
				updatedAt: dbAgent.updatedAt.toISOString(),
				connectors: dbAgent.connectors ?? [],
				shares: Array.isArray(dbAgent.shares) ? dbAgent.shares : [],
			});
		}
		return this.getAgent(userId, agentId);
	}

	getAgentVersions(userId: string, agentId: string): readonly AgentVersionRecord[] {
		return this.versions.get(agentId) ?? [];
	}

	async getAgentVersionsAsync(userId: string, agentId: string): Promise<readonly AgentVersionRecord[]> {
		if (process.env.DATABASE_URL) {
			const rows = await prisma.userAgentVersion.findMany({
				where: { agentId },
				orderBy: { version: "desc" },
			});
			return rows.map((r) => ({
				agentId: r.agentId,
				version: r.version,
				instructions: r.instructions,
				tools: r.tools,
				skills: r.skills,
				connectors: r.connectors ?? [],
				modelPolicy: r.modelPolicy as unknown as UserAgent["modelPolicy"],
				shares: Array.isArray(r.shares) ? (r.shares as unknown as { workspaceId: string; accessLevel: "READ" | "EXECUTE" | "MANAGE" }[]) : [],
				createdAt: r.createdAt.toISOString(),
			}));
		}
		return this.versions.get(agentId) ?? [];
	}

	listAgents(userId: string): readonly UserAgent[] {
		return [...this.agents.values()].filter((a) => a.userId === userId || a.isPublic);
	}

	async listAgentsAsync(userId: string): Promise<readonly UserAgent[]> {
		if (process.env.DATABASE_URL) {
			const dbAgents = await prisma.userAgent.findMany({
				where: {
					OR: [{ userId }, { isPublic: true }],
				},
				orderBy: { updatedAt: "desc" },
			});
			return dbAgents.map((dbAgent) =>
				UserAgentSchema.parse({
					...dbAgent,
					createdAt: dbAgent.createdAt.toISOString(),
					updatedAt: dbAgent.updatedAt.toISOString(),
					connectors: dbAgent.connectors ?? [],
					shares: Array.isArray(dbAgent.shares) ? dbAgent.shares : [],
				}),
			);
		}
		return this.listAgents(userId);
	}

	updateAgent(
		userId: string,
		agentId: string,
		updates: Partial<Omit<UserAgent, "id" | "userId" | "createdAt">>,
	): UserAgent | null {
		const existing = this.agents.get(agentId);
		if (!existing || existing.userId !== userId) return null;

		const nextVersion = existing.version + 1;
		const now = new Date().toISOString();
		const updated: UserAgent = {
			...existing,
			...updates,
			version: nextVersion,
			updatedAt: now,
		};
		const validated = UserAgentSchema.parse(updated);
		this.agents.set(agentId, validated);
		this.recordVersion(validated);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.$transaction(async (tx) => {
				await tx.userAgent.update({
					where: { id: agentId },
					data: {
						name: validated.name,
						description: validated.description,
						instructions: validated.instructions,
						modelPolicy: validated.modelPolicy,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						memoryPolicy: validated.memoryPolicy,
						budget: validated.budget,
						riskPolicy: validated.riskPolicy,
						avatar: validated.avatar,
						version: nextVersion,
						isPublic: validated.isPublic,
						shares: validated.shares as never,
					},
				});
				await tx.userAgentVersion.create({
					data: {
						agentId,
						version: nextVersion,
						instructions: validated.instructions,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						modelPolicy: validated.modelPolicy,
						shares: validated.shares as never,
					},
				});
			}).catch(() => null);
		}

		return validated;
	}

	async updateAgentAsync(
		userId: string,
		agentId: string,
		updates: Partial<Omit<UserAgent, "id" | "userId" | "createdAt">>,
	): Promise<UserAgent | null> {
		const existing = await this.getAgentAsync(userId, agentId);
		if (!existing || existing.userId !== userId) return null;

		const nextVersion = existing.version + 1;
		const now = new Date().toISOString();
		const updated: UserAgent = {
			...existing,
			...updates,
			version: nextVersion,
			updatedAt: now,
		};
		const validated = UserAgentSchema.parse(updated);

		if (process.env.DATABASE_URL) {
			await prisma.$transaction(async (tx) => {
				await tx.userAgent.update({
					where: { id: agentId },
					data: {
						name: validated.name,
						description: validated.description,
						instructions: validated.instructions,
						modelPolicy: validated.modelPolicy,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						memoryPolicy: validated.memoryPolicy,
						budget: validated.budget,
						riskPolicy: validated.riskPolicy,
						avatar: validated.avatar,
						version: nextVersion,
						isPublic: validated.isPublic,
						shares: validated.shares as never,
					},
				});
				await tx.userAgentVersion.create({
					data: {
						agentId,
						version: nextVersion,
						instructions: validated.instructions,
						tools: validated.tools,
						skills: validated.skills,
						connectors: validated.connectors,
						modelPolicy: validated.modelPolicy,
						shares: validated.shares as never,
					},
				});
			});
		}

		this.agents.set(agentId, validated);
		this.recordVersion(validated);
		this.persistToDisk();

		return validated;
	}

	deleteAgent(userId: string, agentId: string): boolean {
		const existing = this.agents.get(agentId);
		if (!existing || existing.userId !== userId) return false;
		const deleted = this.agents.delete(agentId);
		this.versions.delete(agentId);
		this.persistToDisk();
		if (process.env.DATABASE_URL) {
			void prisma.userAgent.delete({ where: { id: agentId } }).catch(() => null);
		}
		return deleted;
	}

	async deleteAgentAsync(userId: string, agentId: string): Promise<boolean> {
		if (process.env.DATABASE_URL) {
			const existing = await prisma.userAgent.findUnique({ where: { id: agentId } });
			if (!existing || existing.userId !== userId) return false;
			await prisma.userAgent.delete({ where: { id: agentId } });
		}
		this.versions.delete(agentId);
		const deleted = this.agents.delete(agentId);
		this.persistToDisk();
		return deleted;
	}

	clearMemoryCache(): void {
		this.agents.clear();
		this.versions.clear();
	}

	reloadFromDisk(): void {
		this.agents.clear();
		this.versions.clear();
		this.loadFromDisk();
	}
}

export const globalUserAgentStore = new UserAgentStore();
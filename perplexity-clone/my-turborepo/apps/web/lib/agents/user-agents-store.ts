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
	avatar: z.string().optional(),
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
	readonly modelPolicy: UserAgent["modelPolicy"];
	readonly createdAt: string;
}

export class UserAgentStore {
	private readonly storeDir: string;
	private readonly dataFilePath: string;
	private readonly versionsFilePath: string;
	private agents = new Map<string, UserAgent>();
	private versions = new Map<string, AgentVersionRecord[]>();

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.dataFilePath = join(this.storeDir, "user-agents.json");
		this.versionsFilePath = join(this.storeDir, "user-agent-versions.json");
		this.ensureStorageDir();
		this.loadFromDisk();
	}

	private ensureStorageDir(): void {
		try {
			if (!existsSync(this.storeDir)) {
				mkdirSync(this.storeDir, { recursive: true });
			}
		} catch {
			// fallback in restricted environments
		}
	}

	private loadFromDisk(): void {
		try {
			if (existsSync(this.dataFilePath)) {
				const raw = readFileSync(this.dataFilePath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const item of parsed) {
						const res = UserAgentSchema.safeParse(item);
						if (res.success) {
							this.agents.set(res.data.id, res.data);
						}
					}
				}
			}
			if (existsSync(this.versionsFilePath)) {
				const raw = readFileSync(this.versionsFilePath, "utf8");
				const parsed = JSON.parse(raw);
				if (typeof parsed === "object" && parsed !== null) {
					for (const [k, v] of Object.entries(parsed)) {
						if (Array.isArray(v)) {
							this.versions.set(k, v);
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
			const agentsArray = [...this.agents.values()];
			const tempFile = `${this.dataFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempFile, JSON.stringify(agentsArray, null, 2), "utf8");
			renameSync(tempFile, this.dataFilePath);

			const versionsObj = Object.fromEntries(this.versions.entries());
			const tempVFile = `${this.versionsFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempVFile, JSON.stringify(versionsObj, null, 2), "utf8");
			renameSync(tempVFile, this.versionsFilePath);
		} catch {
			// fail-safe disk write
		}
	}

	private async syncToDatabase(agent: UserAgent, isDelete = false): Promise<void> {
		if (!process.env.DATABASE_URL) return;
		try {
			if (isDelete) {
				await prisma.userAgent.delete({ where: { id: agent.id } }).catch(() => null);
				return;
			}
			await prisma.userAgent.upsert({
				where: { id: agent.id },
				create: {
					id: agent.id,
					userId: agent.userId,
					name: agent.name,
					description: agent.description,
					instructions: agent.instructions,
					modelPolicy: agent.modelPolicy,
					tools: agent.tools,
					skills: agent.skills,
					memoryPolicy: agent.memoryPolicy,
					budget: agent.budget,
					riskPolicy: agent.riskPolicy,
					avatar: agent.avatar,
					version: agent.version,
					isPublic: agent.isPublic,
				},
				update: {
					name: agent.name,
					description: agent.description,
					instructions: agent.instructions,
					modelPolicy: agent.modelPolicy,
					tools: agent.tools,
					skills: agent.skills,
					memoryPolicy: agent.memoryPolicy,
					budget: agent.budget,
					riskPolicy: agent.riskPolicy,
					avatar: agent.avatar,
					version: agent.version,
					isPublic: agent.isPublic,
				},
			});

			await prisma.userAgentVersion.create({
				data: {
					agentId: agent.id,
					version: agent.version,
					instructions: agent.instructions,
					tools: agent.tools,
					skills: agent.skills,
					modelPolicy: agent.modelPolicy,
				},
			}).catch(() => null);
		} catch {
			// Async sync errors logged, do not block main thread
		}
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
		void this.syncToDatabase(validated);
		return validated;
	}

	private recordVersion(agent: UserAgent): void {
		const record: AgentVersionRecord = {
			agentId: agent.id,
			version: agent.version,
			instructions: agent.instructions,
			tools: [...agent.tools],
			skills: [...agent.skills],
			modelPolicy: { ...agent.modelPolicy },
			createdAt: new Date().toISOString(),
		};
		const existing = this.versions.get(agent.id) ?? [];
		existing.push(record);
		this.versions.set(agent.id, existing);
	}

	getAgent(userId: string, agentId: string): UserAgent | null {
		const agent = this.agents.get(agentId);
		if (!agent) return null;
		// Strict tenant isolation: user must own the agent, or it must be explicitly public
		if (agent.userId !== userId && !agent.isPublic) return null;
		return agent;
	}

	getAgentVersions(userId: string, agentId: string): readonly AgentVersionRecord[] {
		const agent = this.getAgent(userId, agentId);
		if (!agent) return [];
		return this.versions.get(agentId) ?? [];
	}

	listAgents(userId: string): readonly UserAgent[] {
		return [...this.agents.values()].filter((a) => a.userId === userId || a.isPublic);
	}

	updateAgent(userId: string, agentId: string, updates: Partial<Omit<UserAgent, "id" | "userId" | "createdAt">>): UserAgent | null {
		const existing = this.agents.get(agentId);
		// Two-user isolation: only owner can update
		if (!existing || existing.userId !== userId) return null;

		const updated: UserAgent = {
			...existing,
			...updates,
			version: existing.version + 1,
			updatedAt: new Date().toISOString(),
		};
		const validated = UserAgentSchema.parse(updated);
		this.agents.set(agentId, validated);
		this.recordVersion(validated);
		this.persistToDisk();
		void this.syncToDatabase(validated);
		return validated;
	}

	deleteAgent(userId: string, agentId: string): boolean {
		const existing = this.agents.get(agentId);
		// Two-user isolation: only owner can delete
		if (!existing || existing.userId !== userId) return false;
		const deleted = this.agents.delete(agentId);
		this.versions.delete(agentId);
		this.persistToDisk();
		void this.syncToDatabase(existing, true);
		return deleted;
	}

	// For tests: simulate server restart / process termination and reload
	reloadFromDisk(): void {
		this.agents.clear();
		this.versions.clear();
		this.loadFromDisk();
	}
}

export const globalUserAgentStore = new UserAgentStore();

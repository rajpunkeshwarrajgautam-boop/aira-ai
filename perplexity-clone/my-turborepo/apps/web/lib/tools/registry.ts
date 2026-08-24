import { z } from "zod";

import type {
	AgentToolDefinition,
	PublicToolDescriptor,
	ToolAvailability,
} from "./contracts";

function configured(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function configuredState(condition: boolean, configuredDetail: string, missingDetail: string): ToolAvailability {
	return condition
		? { state: "CONFIGURED", detail: configuredDetail }
		: { state: "NOT_CONFIGURED", detail: missingDetail };
}

export class ToolRegistry {
	private readonly definitions = new Map<string, AgentToolDefinition>();

	register(definition: AgentToolDefinition): this {
		if (this.definitions.has(definition.id)) {
			throw new Error(`Tool already registered: ${definition.id}`);
		}
		this.definitions.set(definition.id, definition);
		return this;
	}

	get(id: string): AgentToolDefinition | undefined {
		return this.definitions.get(id);
	}

	list(): readonly AgentToolDefinition[] {
		return [...this.definitions.values()];
	}

	publicDescriptors(): PublicToolDescriptor[] {
		return this.list().map((tool) => ({
			id: tool.id,
			label: tool.label,
			description: tool.description,
			category: tool.category,
			permission: tool.permission,
			sideEffecting: tool.sideEffecting,
			timeoutMs: tool.timeoutMs,
			cancellable: tool.cancellable,
			audit: tool.audit,
			availability: tool.availability(),
		}));
	}
}

const webSearchTool: AgentToolDefinition = {
	id: "web_search",
	label: "Web search",
	description: "Grounded Exa retrieval used by AIRA research and citations.",
	category: "research",
	inputSchema: z.object({
		query: z.string().trim().min(1).max(16_000),
		numResults: z.number().int().min(1).max(50).optional(),
	}),
	outputSchema: z.object({
		requestId: z.string().optional(),
		searchType: z.string().optional(),
		results: z.array(z.object({ url: z.string(), title: z.string(), excerpt: z.string().optional() })),
	}),
	permission: "READ",
	sideEffecting: false,
	timeoutMs: 60_000,
	cancellable: true,
	audit: "standard",
	availability: () =>
		configuredState(
			configured(process.env.EXA_API_KEY),
			"Exa credentials are configured. Health is verified when the tool is invoked.",
			"EXA_API_KEY is not configured.",
		),
};

const memoryTool: AgentToolDefinition = {
	id: "memory",
	label: "Memory",
	description: "Read user-owned persistent memory for relevant operating context.",
	category: "context",
	inputSchema: z.object({
		query: z.string().trim().min(1).max(4_000),
		limit: z.number().int().min(1).max(50).optional(),
	}),
	outputSchema: z.object({ memories: z.array(z.object({ id: z.string(), content: z.string() })) }),
	permission: "READ",
	sideEffecting: false,
	timeoutMs: 10_000,
	cancellable: false,
	audit: "standard",
	availability: () =>
		configuredState(
			configured(process.env.DATABASE_URL),
			"Persistent memory storage is configured. Database health is verified on access.",
			"DATABASE_URL is not configured.",
		),
};

const knowledgeTool: AgentToolDefinition = {
	id: "knowledge",
	label: "Knowledge",
	description: "Read user-owned uploaded knowledge after ingestion and retrieval.",
	category: "context",
	inputSchema: z.object({
		query: z.string().trim().min(1).max(4_000),
		assetIds: z.array(z.string()).max(50).optional(),
	}),
	outputSchema: z.object({
		chunks: z.array(
			z.object({ assetId: z.string(), ordinal: z.number().int().nonnegative(), content: z.string() }),
		),
	}),
	permission: "READ",
	sideEffecting: false,
	timeoutMs: 20_000,
	cancellable: false,
	audit: "standard",
	availability: () => {
		const enabled = process.env.MULTIMODAL_INGESTION_ENABLED === "true";
		const storageConfigured =
			configured(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
			configured(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
			configured(process.env.AIRA_KNOWLEDGE_WORKER_TOKEN);
		return configuredState(
			enabled && storageConfigured,
			"Knowledge ingestion dependencies are configured. Worker health is verified during ingestion.",
			"Knowledge ingestion is disabled or its storage/worker credentials are incomplete.",
		);
	},
};

const codeExecutionTool: AgentToolDefinition = {
	id: "code_execution",
	label: "Code execution",
	description: "Execute bounded Python code through AIRA's isolated sandbox gateway.",
	category: "execution",
	inputSchema: z.object({
		language: z.literal("python"),
		code: z.string().min(1).max(100_000),
	}),
	outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int() }),
	permission: "CODE_EXECUTION",
	sideEffecting: true,
	timeoutMs: 30_000,
	cancellable: true,
	audit: "required",
	availability: () =>
		configuredState(
			process.env.PYTHON_SANDBOX_ENABLED === "true" &&
				configured(process.env.AIRA_SANDBOX_URL) &&
				configured(process.env.AIRA_SANDBOX_TOKEN),
			"Sandbox endpoint and credentials are configured. Isolation/health must still pass before execution.",
			"The external sandbox runtime is not configured.",
		),
};

const browserTool: AgentToolDefinition = {
	id: "browser",
	label: "Browser",
	description: "Isolated browser/computer-use runtime for navigation and interaction.",
	category: "execution",
	inputSchema: z.object({
		url: z.string().url(),
		action: z.enum(["navigate", "read", "click", "type", "scroll", "screenshot"]),
	}),
	outputSchema: z.object({ ok: z.boolean(), result: z.unknown().optional() }),
	permission: "BROWSER_ACTION",
	sideEffecting: true,
	timeoutMs: 45_000,
	cancellable: true,
	audit: "required",
	availability: () => ({
		state: "UNAVAILABLE",
		detail: "No production browser runtime has been activated yet.",
	}),
};

export function createDefaultToolRegistry(): ToolRegistry {
	return new ToolRegistry()
		.register(webSearchTool)
		.register(memoryTool)
		.register(knowledgeTool)
		.register(codeExecutionTool)
		.register(browserTool);
}

export const defaultToolRegistry = createDefaultToolRegistry();

import { z } from "zod";

import {
	decideToolInvocation,
	type PublicToolDescriptor,
	type ToolApprovalMode,
	type ToolPermissionClass,
} from "@/lib/tools/contracts";

export interface AgentTool<TInput = unknown, TOutput = unknown, TContext = unknown> {
	name: string;
	description: string;
	category: string;
	requiresAuth: boolean;
	requiresPermission: boolean;
	inputSchema: z.ZodType<TInput>;
	execute: (input: TInput, context?: TContext) => Promise<TOutput>;
}

export interface ToolApprovalProof {
	readonly userId: string;
	readonly runId: string;
	readonly approvalId: string;
}

export interface ToolApprovalRequestContext {
	readonly userId: string;
	readonly runId: string;
	readonly approvalKey: string;
	readonly summary: string;
	readonly request?: unknown;
}

export interface ToolExecutionOptions {
	readonly mode?: ToolApprovalMode;
	readonly approval?: ToolApprovalProof;
	readonly approvalRequest?: ToolApprovalRequestContext;
}

type ToolExecutionPolicyCode =
	| "TOOL_UNAVAILABLE"
	| "TOOL_APPROVAL_REQUIRED"
	| "TOOL_PLAN_ONLY";

export class ToolExecutionPolicyError extends Error {
	readonly code: ToolExecutionPolicyCode;
	readonly toolId: string;
	readonly approvalId: string | null;

	constructor(
		code: ToolExecutionPolicyCode,
		message: string,
		toolId: string,
		approvalId: string | null = null,
	) {
		super(message);
		this.name = "ToolExecutionPolicyError";
		this.code = code;
		this.toolId = toolId;
		this.approvalId = approvalId;
	}
}

function configured(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function permissionForTool(tool: AgentTool): ToolPermissionClass {
	if (tool.name === "python_sandbox") return "CODE_EXECUTION";
	return tool.requiresPermission ? "WRITE" : "READ";
}

function availabilityForTool(tool: AgentTool): PublicToolDescriptor["availability"] {
	if (tool.name === "web_search") {
		return configured(process.env.EXA_API_KEY)
			? { state: "CONFIGURED", detail: "Exa credentials are configured. Health is verified when the tool is invoked." }
			: { state: "NOT_CONFIGURED", detail: "EXA_API_KEY is not configured." };
	}
	if (tool.name === "memory_lookup") {
		return configured(process.env.DATABASE_URL)
			? { state: "CONFIGURED", detail: "Persistent memory storage is configured. Database health is verified on access." }
			: { state: "NOT_CONFIGURED", detail: "DATABASE_URL is not configured." };
	}
	if (tool.name === "python_sandbox") {
		return process.env.PYTHON_SANDBOX_ENABLED === "true" && configured(process.env.AIRA_SANDBOX_URL) && configured(process.env.AIRA_SANDBOX_TOKEN)
			? { state: "CONFIGURED", detail: "Sandbox endpoint and credentials are configured. Isolation and health must still pass before execution." }
			: { state: "NOT_CONFIGURED", detail: "The external sandbox runtime is not configured." };
	}
	return { state: "AVAILABLE", detail: "Built-in local tool is available in the AIRA application runtime." };
}

function descriptorForTool(tool: AgentTool): PublicToolDescriptor {
	const permission = permissionForTool(tool);
	return {
		id: tool.name,
		label: tool.name
			.split("_")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" "),
		description: tool.description,
		category: tool.category,
		permission,
		sideEffecting: permission !== "READ",
		timeoutMs: tool.name === "python_sandbox" ? 12_000 : tool.name === "web_search" ? 60_000 : 10_000,
		cancellable: tool.name === "python_sandbox" || tool.name === "web_search",
		audit: permission === "READ" ? "standard" : "required",
		availability: availabilityForTool(tool),
	};
}

function virtualCapabilities(): readonly PublicToolDescriptor[] {
	const sandboxConfigured =
		process.env.PYTHON_SANDBOX_ENABLED === "true" &&
		configured(process.env.AIRA_SANDBOX_URL) &&
		configured(process.env.AIRA_SANDBOX_TOKEN);
	const knowledgeConfigured =
		process.env.MULTIMODAL_INGESTION_ENABLED === "true" &&
		configured(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
		configured(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
		configured(process.env.AIRA_KNOWLEDGE_WORKER_TOKEN);
	return [
		{
			id: "python_sandbox",
			label: "Python Sandbox",
			description: "Execute bounded Python code through AIRA's isolated external sandbox gateway.",
			category: "execution",
			permission: "CODE_EXECUTION",
			sideEffecting: true,
			timeoutMs: 12_000,
			cancellable: true,
			audit: "required",
			availability: sandboxConfigured
				? { state: "CONFIGURED", detail: "Sandbox endpoint and credentials are configured. Isolation and health must still pass before execution." }
				: { state: "NOT_CONFIGURED", detail: "The external sandbox runtime is not configured." },
		},
		{
			id: "knowledge",
			label: "Knowledge",
			description: "Read user-owned uploaded knowledge after ingestion and retrieval.",
			category: "context",
			permission: "READ",
			sideEffecting: false,
			timeoutMs: 20_000,
			cancellable: false,
			audit: "standard",
			availability: knowledgeConfigured
				? { state: "CONFIGURED", detail: "Knowledge ingestion dependencies are configured. Worker health is verified during ingestion." }
				: { state: "NOT_CONFIGURED", detail: "Knowledge ingestion is disabled or its storage/worker credentials are incomplete." },
		},
		{
			id: "browser",
			label: "Browser",
			description: "Isolated browser/computer-use runtime for navigation and interaction.",
			category: "execution",
			permission: "BROWSER_ACTION",
			sideEffecting: true,
			timeoutMs: 45_000,
			cancellable: true,
			audit: "required",
			availability: { state: "UNAVAILABLE", detail: "No production browser runtime has been activated yet." },
		},
	];
}

async function assertExecutionAllowed(
	descriptor: PublicToolDescriptor,
	options: ToolExecutionOptions,
): Promise<void> {
	if (descriptor.availability.state === "NOT_CONFIGURED" || descriptor.availability.state === "UNAVAILABLE" || descriptor.availability.state === "AUTH_REQUIRED") {
		throw new ToolExecutionPolicyError(
			"TOOL_UNAVAILABLE",
			`${descriptor.label} is not available for execution: ${descriptor.availability.detail}`,
			descriptor.id,
		);
	}
	const mode = options.mode ?? "auto";
	const decision = decideToolInvocation(mode, descriptor.permission);
	if (decision === "PLAN_ONLY") {
		throw new ToolExecutionPolicyError(
			"TOOL_PLAN_ONLY",
			`${descriptor.label} cannot execute while tool mode is plan_only.`,
			descriptor.id,
		);
	}
	if (decision !== "REQUIRE_APPROVAL") return;

	if (options.approval) {
		const { hasApprovedToolAction } = await import("../tool-approvals");
		const approved = await hasApprovedToolAction(
			options.approval.userId,
			options.approval.runId,
			options.approval.approvalId,
			descriptor.id,
		);
		if (approved) return;
	}

	if (options.approvalRequest) {
		const { requestToolApproval } = await import("../tool-approvals");
		const approval = await requestToolApproval({
			userId: options.approvalRequest.userId,
			runId: options.approvalRequest.runId,
			approvalKey: options.approvalRequest.approvalKey,
			toolId: descriptor.id,
			permission: descriptor.permission,
			mode,
			summary: options.approvalRequest.summary,
			request: options.approvalRequest.request,
		});
		throw new ToolExecutionPolicyError(
			"TOOL_APPROVAL_REQUIRED",
			`${descriptor.label} requires explicit approval before execution.`,
			descriptor.id,
			approval.id,
		);
	}

	throw new ToolExecutionPolicyError(
		"TOOL_APPROVAL_REQUIRED",
		`${descriptor.label} requires explicit approval before execution.`,
		descriptor.id,
	);
}

export class ToolRegistry {
	private tools = new Map<string, AgentTool<unknown, unknown, unknown>>();

	registerTool<TInput, TOutput, TContext = unknown>(
		tool: AgentTool<TInput, TOutput, TContext>,
	) {
		if (this.tools.has(tool.name)) return;
		this.tools.set(
			tool.name,
			tool as unknown as AgentTool<unknown, unknown, unknown>,
		);
	}

	getTool(name: string): AgentTool<unknown, unknown, unknown> | undefined {
		return this.tools.get(name);
	}

	getAllTools(): AgentTool<unknown, unknown, unknown>[] {
		return Array.from(this.tools.values());
	}

	publicDescriptors(): PublicToolDescriptor[] {
		const executable = this.getAllTools().map(descriptorForTool);
		const executableIds = new Set(executable.map((tool) => tool.id));
		return [
			...executable,
			...virtualCapabilities().filter((tool) => !executableIds.has(tool.id)),
		];
	}

	async executeTool<TOutput = unknown, TContext = unknown>(
		name: string,
		input: unknown,
		context?: TContext,
		options: ToolExecutionOptions = {},
	): Promise<TOutput> {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(`Tool ${name} not found in registry.`);
		}
		await assertExecutionAllowed(descriptorForTool(tool), options);

		const parsedInput = tool.inputSchema.safeParse(input);
		if (!parsedInput.success) {
			throw new Error(`Invalid input for tool ${name}: ${parsedInput.error.message}`);
		}

		try {
			const result = await tool.execute(parsedInput.data, context);
			return result as TOutput;
		} catch (error) {
			console.error(`Error executing tool ${name}:`, error);
			throw error;
		}
	}
}

export const globalToolRegistry = new ToolRegistry();

let builtInsRegistered = false;

export async function registerBuiltInTools() {
	if (builtInsRegistered) return;
	const { webSearchTool } = await import("./webSearchTool");
	const { citationFormatTool } = await import("./citationFormatTool");
	const { memoryLookupTool } = await import("./memoryLookupTool");
	const { calculatorTool } = await import("./calculatorTool");

	globalToolRegistry.registerTool(webSearchTool);
	globalToolRegistry.registerTool(citationFormatTool);
	globalToolRegistry.registerTool(memoryLookupTool);
	globalToolRegistry.registerTool(calculatorTool);

	if (process.env.PYTHON_SANDBOX_ENABLED === "true") {
		const { pythonSandboxTool } = await import("./pythonSandboxTool");
		globalToolRegistry.registerTool(pythonSandboxTool);
	}
	builtInsRegistered = true;
}

export async function getPublicToolDescriptors(): Promise<PublicToolDescriptor[]> {
	await registerBuiltInTools();
	return globalToolRegistry.publicDescriptors();
}

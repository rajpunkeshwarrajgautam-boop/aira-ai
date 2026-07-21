import { z } from "zod";

export interface AgentTool<TInput = unknown, TOutput = unknown, TContext = unknown> {
	name: string;
	description: string;
	category: string;
	requiresAuth: boolean;
	requiresPermission: boolean;
	inputSchema: z.ZodType<TInput>;
	execute: (input: TInput, context?: TContext) => Promise<TOutput>;
}

export class ToolRegistry {
	private tools = new Map<string, AgentTool<unknown, unknown, unknown>>();

	registerTool<TInput, TOutput, TContext = unknown>(
		tool: AgentTool<TInput, TOutput, TContext>,
	) {
		if (this.tools.has(tool.name)) {
			console.warn(`Tool ${tool.name} is already registered. Overwriting.`);
		}
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

	async executeTool<TOutput = unknown, TContext = unknown>(
		name: string,
		input: unknown,
		context?: TContext,
	): Promise<TOutput> {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(`Tool ${name} not found in registry.`);
		}

		// Validation step
		const parsedInput = tool.inputSchema.safeParse(input);
		if (!parsedInput.success) {
			throw new Error(`Invalid input for tool ${name}: ${parsedInput.error.message}`);
		}

		// Security step wrapper (auth/permissions would be checked here in higher layers)
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

// Lazy registration to avoid circular dependencies
export async function registerBuiltInTools() {
	const { webSearchTool } = await import("./webSearchTool");
	const { citationFormatTool } = await import("./citationFormatTool");
	const { memoryLookupTool } = await import("./memoryLookupTool");
	const { calculatorTool } = await import("./calculatorTool");

	globalToolRegistry.registerTool(webSearchTool);
	globalToolRegistry.registerTool(citationFormatTool);
	globalToolRegistry.registerTool(memoryLookupTool);
	globalToolRegistry.registerTool(calculatorTool);
}

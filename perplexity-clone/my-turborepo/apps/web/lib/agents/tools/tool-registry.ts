import { z } from "zod";

export interface AgentTool<TInput = any, TOutput = any> {
	name: string;
	description: string;
	category: string;
	requiresAuth: boolean;
	requiresPermission: boolean;
	inputSchema: z.ZodType<TInput>;
	execute: (input: TInput, context?: any) => Promise<TOutput>;
}

export class ToolRegistry {
	private tools = new Map<string, AgentTool>();

	registerTool(tool: AgentTool) {
		if (this.tools.has(tool.name)) {
			console.warn(`Tool ${tool.name} is already registered. Overwriting.`);
		}
		this.tools.set(tool.name, tool);
	}

	getTool(name: string): AgentTool | undefined {
		return this.tools.get(name);
	}

	getAllTools(): AgentTool[] {
		return Array.from(this.tools.values());
	}

	async executeTool(name: string, input: unknown, context?: any): Promise<any> {
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
			return result;
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

	globalToolRegistry.registerTool(webSearchTool);
	globalToolRegistry.registerTool(citationFormatTool);
	globalToolRegistry.registerTool(memoryLookupTool);
}

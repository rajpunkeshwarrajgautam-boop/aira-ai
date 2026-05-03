import { z } from "zod";
import type { AgentTool } from "./tool-registry";
import { getFollowUpContext } from "../../conversation-memory";

export const MemoryLookupSchema = z.object({
	userId: z.string().min(1, "User ID is required"),
	query: z.string().min(1, "Query is required"),
	conversationId: z.string().optional(),
	parentMessageId: z.string().optional(),
	messageLimit: z.number().optional().default(10),
	memoryLimit: z.number().optional().default(5),
});

export type MemoryLookupInput = z.infer<typeof MemoryLookupSchema>;

export const memoryLookupTool: AgentTool<MemoryLookupInput> = {
	name: "memory_lookup",
	description: "Retrieves past conversation context and persistent memories for a user session.",
	category: "memory",
	requiresAuth: true,
	requiresPermission: false,
	inputSchema: MemoryLookupSchema,
	execute: async (input) => {
		try {
			const context = await getFollowUpContext({
				userId: input.userId,
				query: input.query,
				conversationId: input.conversationId,
				parentMessageId: input.parentMessageId,
				messageLimit: input.messageLimit,
				memoryLimit: input.memoryLimit,
			});
			return context;
		} catch (error) {
			console.error("Memory Lookup Tool Error:", error);
			throw new Error("Failed to retrieve conversation context.");
		}
	},
};

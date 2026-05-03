import { z } from "zod";
import type { AgentTool } from "./tool-registry";
import { createExaSearchService } from "../../../src/services/search";

export const WebSearchSchema = z.object({
	query: z.string().min(1, "Search query is required"),
	numResults: z.number().optional().default(5),
	includeContents: z.boolean().optional().default(true),
});

export type WebSearchInput = z.infer<typeof WebSearchSchema>;

export const webSearchTool: AgentTool<WebSearchInput> = {
	name: "web_search",
	description: "Searches the web using Exa for high quality information.",
	category: "research",
	requiresAuth: true,
	requiresPermission: false, // Reading the web is generally safe
	inputSchema: WebSearchSchema,
	execute: async (input) => {
		const exa = createExaSearchService();
		try {
			const results = await exa.search(input.query, {
				numResults: input.numResults,
				contents: input.includeContents ? { textMaxCharacters: 3500, highlightMaxCharacters: 2000 } : { textMaxCharacters: 0, highlightMaxCharacters: 0 },
			});
			return results;
		} catch (error) {
			console.error("Exa Search Tool Error:", error);
			throw new Error("Failed to execute web search.");
		}
	},
};

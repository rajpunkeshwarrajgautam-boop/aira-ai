import { z } from "zod";
import type { AgentTool } from "./tool-registry";
import { buildCitationContextBlocks, rankFilterAndNumberSources } from "../../../src/services/citations";

export const CitationFormatSchema = z.object({
	candidates: z.array(z.any()),
	rankingOptions: z.any().optional(),
});

export type CitationFormatInput = z.infer<typeof CitationFormatSchema>;

export const citationFormatTool: AgentTool<CitationFormatInput> = {
	name: "citation_format",
	description: "Ranks, filters, and formats raw search candidates into a markdown block with numbered inline citations.",
	category: "research",
	requiresAuth: false,
	requiresPermission: false,
	inputSchema: CitationFormatSchema,
	execute: async (input) => {
		try {
			const rankedSources = rankFilterAndNumberSources(input.candidates, input.rankingOptions);
			const formattedBlocks = buildCitationContextBlocks(rankedSources);
			
			return {
				rankedSources,
				...formattedBlocks,
			};
		} catch (error) {
			console.error("Citation Format Tool Error:", error);
			throw new Error("Failed to format citations.");
		}
	},
};

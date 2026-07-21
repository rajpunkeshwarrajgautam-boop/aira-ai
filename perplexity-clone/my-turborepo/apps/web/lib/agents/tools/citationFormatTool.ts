import { z } from "zod";
import type { AgentTool } from "./tool-registry";
import { buildCitationContextBlocks, rankFilterAndNumberSources } from "../../../src/services/citations";

const SourceCandidateSchema = z.object({
	url: z.string().min(1),
	title: z.string(),
	publishedDate: z.string().nullable(),
	excerpt: z.string(),
	summary: z.string().optional(),
	highlightScores: z.array(z.number()).optional(),
	originalRank: z.number().int().nonnegative(),
});

export const CitationFormatSchema = z.object({
	candidates: z.array(SourceCandidateSchema),
	rankingOptions: z
		.object({
			maxSources: z.number().int().positive().optional(),
			minExcerptLength: z.number().int().nonnegative().optional(),
			isMedical: z.boolean().optional(),
		})
		.optional(),
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

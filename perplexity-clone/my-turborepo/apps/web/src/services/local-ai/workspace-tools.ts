import { z } from "zod";

import { getRelevantKnowledgeContext } from "@/lib/knowledge-assets";
import { getRelevantPersistentMemories } from "@/lib/persistent-memory";

import type { LocalAiToolDefinition } from "./llama-cpp-client";

const WorkspaceSearchSchema = z.object({
	query: z.string().trim().min(2).max(2000),
	limit: z.number().int().min(1).max(8).optional().default(5),
});

const LeadBaselineSchema = z.object({
	fit: z.number().int().min(0).max(10),
	urgency: z.number().int().min(0).max(10),
	authority: z.number().int().min(0).max(10),
	data_quality: z.number().int().min(0).max(10),
});

export const VIREXA_LOCAL_TOOLS: readonly LocalAiToolDefinition[] = [
	{
		type: "function",
		function: {
			name: "search_virexa_workspace",
			description:
				"Search the authenticated user's AIRA/Virexa persistent memory and uploaded knowledge for private context relevant to a query. Use this before answering questions about prior work, company context, documents, or remembered decisions.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Specific search query." },
					limit: { type: "integer", minimum: 1, maximum: 8, default: 5 },
				},
				required: ["query"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "score_lead_baseline",
			description:
				"Compute a deterministic 0-100 baseline lead score from four 0-10 ratings. Use only when the user asks for lead qualification or prioritization.",
			parameters: {
				type: "object",
				properties: {
					fit: { type: "integer", minimum: 0, maximum: 10 },
					urgency: { type: "integer", minimum: 0, maximum: 10 },
					authority: { type: "integer", minimum: 0, maximum: 10 },
					data_quality: { type: "integer", minimum: 0, maximum: 10 },
				},
				required: ["fit", "urgency", "authority", "data_quality"],
				additionalProperties: false,
			},
		},
	},
];

function parseToolArguments(raw: string): unknown {
	if (!raw.trim()) return {};
	return JSON.parse(raw) as unknown;
}

export function createVirexaLocalToolExecutor(userId: string) {
	return async (name: string, rawArguments: string): Promise<unknown> => {
		if (name === "search_virexa_workspace") {
			const args = WorkspaceSearchSchema.parse(parseToolArguments(rawArguments));
			const [memories, knowledge] = await Promise.all([
				getRelevantPersistentMemories(userId, args.query, args.limit),
				getRelevantKnowledgeContext(userId, args.query, args.limit),
			]);
			return {
				query: args.query,
				memories: memories.slice(0, args.limit),
				knowledge: knowledge.slice(0, args.limit),
			};
		}

		if (name === "score_lead_baseline") {
			const args = LeadBaselineSchema.parse(parseToolArguments(rawArguments));
			const score = Math.round(
				args.fit * 4 + args.urgency * 2.5 + args.authority * 2 + args.data_quality * 1.5,
			);
			return {
				score: Math.min(100, Math.max(0, score)),
				weights: { fit: 0.4, urgency: 0.25, authority: 0.2, data_quality: 0.15 },
			};
		}

		throw new Error(`Unknown local tool: ${name}`);
	};
}

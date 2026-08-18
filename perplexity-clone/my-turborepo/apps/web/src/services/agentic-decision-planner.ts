import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { AgenticSearchSpec } from "./agentic-answer-policy";
import { ProviderRouter } from "./providers/provider-router";

const DecisionOptionSchema = z.object({
	name: z.string().trim().min(3).max(100),
	buyer: z.string().trim().min(2).max(140),
	hypothesis: z.string().trim().min(12).max(360),
	whyItMightWin: z.string().trim().min(8).max(300),
	failureMode: z.string().trim().min(8).max(300),
	evidenceQuery: z.string().trim().min(8).max(360),
});

const DecisionBriefSchema = z.object({
	decisionQuestion: z.string().trim().min(5).max(300),
	options: z.array(DecisionOptionSchema).min(3).max(4),
	decisionCriteria: z.array(z.string().trim().min(2).max(80)).min(4).max(8),
});

export type AgenticDecisionBrief = z.infer<typeof DecisionBriefSchema>;

function extractJsonObject(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Decision planner returned no JSON object.");
	return trimmed.slice(start, end + 1);
}

async function collectText(
	router: ProviderRouter,
	messages: ChatCompletionMessageParam[],
	abortSignal?: AbortSignal,
): Promise<string> {
	let text = "";
	for await (const delta of router.streamChat(messages, {
		temperature: 0.1,
		maxCompletionTokens: 1200,
		abortSignal,
	})) {
		text += delta;
	}
	return text;
}

export async function buildAgenticDecisionBrief(args: {
	readonly router: ProviderRouter;
	readonly query: string;
	readonly contextualMemory?: readonly string[];
	readonly chatHistory?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
	readonly abortSignal?: AbortSignal;
}): Promise<AgenticDecisionBrief | null> {
	const context = [
		...(args.contextualMemory ?? []).map((m) => `MEMORY: ${m}`),
		...(args.chatHistory ?? []).slice(-6).map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, 1200)}`),
	].join("\n");

	const messages: ChatCompletionMessageParam[] = [
		{
			role: "system",
			content: `You are AIRA's private decision-hypothesis planner. Return STRICT JSON only. Do not answer the user's question yet.

Your job is to prevent search anchoring. Before web retrieval, form 3-4 materially different plausible options that deserve testing. Do not make all options variations of the same business model.

For business/startup decisions, options should differ in business model or buyer/value-delivery mechanism when plausible (for example product SaaS vs productized service vs managed automation vs infrastructure/tooling). Do not default to GST, vertical SaaS, chatbots, or any trendy category unless it is genuinely one of several hypotheses.

Use user context as current state when relevant. Never recommend duplicating a company, product, registration, purchase, or infrastructure that context says already exists.

Each evidenceQuery must be a neutral search query that can falsify as well as support the option. Search for customer pain/demand, substitutes/competition, pricing or willingness to pay, distribution feasibility, implementation burden, and current market evidence. Avoid leading queries such as "why X is best".

Return exactly:
{
  "decisionQuestion": "short decision being tested",
  "options": [
    {
      "name": "distinct option",
      "buyer": "specific buyer",
      "hypothesis": "what must be true for this to win",
      "whyItMightWin": "main upside",
      "failureMode": "strongest reason it may fail",
      "evidenceQuery": "neutral evidence search"
    }
  ],
  "decisionCriteria": ["criterion", "criterion", "criterion", "criterion"]
}`,
		},
		{
			role: "user",
			content: `${context ? `Relevant user state:\n${context}\n\n` : ""}User decision:\n${args.query}`,
		},
	];

	try {
		const raw = await collectText(args.router, messages, args.abortSignal);
		return DecisionBriefSchema.parse(JSON.parse(extractJsonObject(raw)));
	} catch (error) {
		console.warn("[AIRA agentic planner] Could not build structured decision brief:", error instanceof Error ? error.message : String(error));
		return null;
	}
}

export function decisionBriefSearchSpecs(brief: AgenticDecisionBrief): AgenticSearchSpec[] {
	return brief.options.slice(0, 4).map((option) => ({
		query: option.evidenceQuery,
		numResults: 6,
	}));
}

export function renderDecisionBrief(brief: AgenticDecisionBrief): string {
	const options = brief.options
		.map(
			(option, index) =>
				`${index + 1}. ${option.name}\n   Buyer: ${option.buyer}\n   Hypothesis: ${option.hypothesis}\n   Potential advantage: ${option.whyItMightWin}\n   Failure mode: ${option.failureMode}`,
		)
		.join("\n");
	return `Decision being tested: ${brief.decisionQuestion}\nCriteria: ${brief.decisionCriteria.join(", ")}\n\nCompeting hypotheses:\n${options}`;
}

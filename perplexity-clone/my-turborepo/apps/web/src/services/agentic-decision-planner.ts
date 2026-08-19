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

const BUSINESS_DECISION_RE = /\b(business|startup|saas|market|customer|revenue|mrr|arr|pricing|go-to-market|gtm|sales|distribution|founder|venture|company|product idea|unit economics|build an ai)\b/i;
const INDIA_RE = /\b(india|indian|₹|rs\.?|rupees?|gst|mca|dpdp|cbic|sebi|rbi|udyam|msme|startup india)\b/i;

function extractJsonObject(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Decision planner returned no JSON object.");
	return trimmed.slice(start, end + 1);
}

function parseDecisionBrief(raw: string): AgenticDecisionBrief {
	return DecisionBriefSchema.parse(JSON.parse(extractJsonObject(raw)));
}

function compactQuery(query: string, max = 190): string {
	return query.trim().replace(/\s+/g, " ").slice(0, max);
}

function deterministicFallbackBrief(query: string): AgenticDecisionBrief {
	const q = compactQuery(query);
	if (BUSINESS_DECISION_RE.test(query)) {
		const market = INDIA_RE.test(query) ? "India" : "the target market";
		return DecisionBriefSchema.parse({
			decisionQuestion: `Which AI business model best fits the user's constraints and route to revenue?`,
			options: [
				{
					name: "Productized AI implementation service",
					buyer: "SMEs or mid-market teams with one expensive repetitive workflow",
					hypothesis: "A narrowly packaged automation outcome can be sold before building a large product and can reach first revenue with modest capital.",
					whyItMightWin: "Fastest validation and cash generation because the offer sells an outcome rather than a new platform.",
					failureMode: "Custom delivery can become founder-heavy and margins can collapse if the scope is not standardized.",
					evidenceQuery: `${q} ${market} productized AI automation service SME customer pain willingness to pay implementation demand alternatives`,
				},
				{
					name: "Vertical AI workflow product",
					buyer: "A specific industry segment that repeats the same high-value workflow",
					hypothesis: "The same painful workflow occurs often enough across many buyers to justify a repeatable software product with recurring revenue.",
					whyItMightWin: "More scalable recurring economics if the workflow, integrations, and distribution repeat across customers.",
					failureMode: "Distribution, integration complexity, or weak willingness to switch can make product development outrun demand.",
					evidenceQuery: `${q} ${market} vertical AI workflow software customer demand substitutes competitors pricing adoption distribution evidence`,
				},
				{
					name: "Managed AI operations service",
					buyer: "Businesses that want an AI-enabled operational result without owning the implementation",
					hypothesis: "Buyers will pay recurring fees for a managed result when reliability and human oversight matter more than self-service software.",
					whyItMightWin: "Can combine automation with human QA, making adoption easier while producing recurring service revenue.",
					failureMode: "Support load and manual exceptions can prevent scale if automation quality or process boundaries are poor.",
					evidenceQuery: `${q} ${market} managed AI operations service recurring demand outsourcing economics customer acquisition alternatives`,
				},
				{
					name: "AI developer or infrastructure tool",
					buyer: "Developers, agencies, or AI product teams with a repeated technical bottleneck",
					hypothesis: "A technical bottleneck is painful and common enough that teams will adopt a focused tool instead of building it internally.",
					whyItMightWin: "Software-like margins and global distribution are possible if the tool solves a sharp technical pain.",
					failureMode: "Open-source substitutes and fast model/platform changes can erase differentiation quickly.",
					evidenceQuery: `${q} AI developer infrastructure tooling bottleneck demand open source substitutes pricing adoption evidence`,
				},
			],
			decisionCriteria: [
				"pain and willingness to pay",
				"time to first revenue",
				"reachable distribution",
				"capital fit",
				"gross-margin potential",
				"delivery burden",
				"competitive substitutes",
				"fit with existing assets",
			],
		});
	}

	return DecisionBriefSchema.parse({
		decisionQuestion: `Which materially different approach best solves the user's decision?`,
		options: [
			{
				name: "Focused specialist approach",
				buyer: "The narrowest user or stakeholder with the clearest pain",
				hypothesis: "A tightly scoped solution produces the best value-to-complexity ratio.",
				whyItMightWin: "Lower execution risk and faster validation.",
				failureMode: "The scope may be too narrow to create enough value or upside.",
				evidenceQuery: `${q} focused specialist approach evidence tradeoffs alternatives`,
			},
			{
				name: "Managed or service-led approach",
				buyer: "Users who value an outcome more than self-service control",
				hypothesis: "Hands-on delivery reduces adoption friction and improves near-term results.",
				whyItMightWin: "Allows learning from real use before committing to a broad product or system.",
				failureMode: "Operational burden may scale poorly.",
				evidenceQuery: `${q} managed service approach evidence cost reliability alternatives`,
			},
			{
				name: "Broader platform or system approach",
				buyer: "Users who need repeatability, integration, or self-service at larger scale",
				hypothesis: "Upfront complexity is justified by reuse and scale.",
				whyItMightWin: "Potentially stronger long-term leverage and repeatability.",
				failureMode: "Higher cost and complexity can delay proof of value.",
				evidenceQuery: `${q} platform system approach evidence implementation cost alternatives`,
			},
		],
		decisionCriteria: ["expected value", "cost", "time-to-value", "risk", "reversibility", "fit"],
	});
}

async function collectText(
	router: ProviderRouter,
	messages: ChatCompletionMessageParam[],
	abortSignal?: AbortSignal,
	maxCompletionTokens = 1800,
): Promise<string> {
	let text = "";
	for await (const delta of router.streamChat(messages, {
		temperature: 0,
		maxCompletionTokens,
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

Output rules:
- Return one JSON object and nothing else.
- Do not include markdown fences, prose, prefaces, analysis, or visible thinking.
- The first non-whitespace character must be { and the last non-whitespace character must be }.

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
		const raw = await collectText(args.router, messages, args.abortSignal, 1800);
		return parseDecisionBrief(raw);
	} catch (firstError) {
		if (args.abortSignal?.aborted) return null;
		console.warn(
			"[AIRA agentic planner] Planner output was invalid; retrying once:",
			firstError instanceof Error ? firstError.message : String(firstError),
		);
		try {
			const retryMessages: ChatCompletionMessageParam[] = [
				...messages,
				{
					role: "user",
					content:
						"Your previous planner response was invalid. Retry the same task. Return ONLY the required JSON object, with 3-4 materially different options and no markdown, prose, analysis, or thinking.",
				},
			];
			const retryRaw = await collectText(args.router, retryMessages, args.abortSignal, 2600);
			return parseDecisionBrief(retryRaw);
		} catch (retryError) {
			if (args.abortSignal?.aborted) return null;
			console.warn(
				"[AIRA agentic planner] Structured planner failed twice; using deterministic decision hypotheses:",
				retryError instanceof Error ? retryError.message : String(retryError),
			);
			return deterministicFallbackBrief(args.query);
		}
	}
}

export function decisionBriefSearchSpecs(brief: AgenticDecisionBrief): AgenticSearchSpec[] {
	return brief.options.slice(0, 4).map((option) => ({
		query: option.evidenceQuery,
		numResults: 7,
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

import { z } from "zod";

import {
	buildCitationContextBlocks,
	findUnknownCitationIndices,
	rankFilterAndNumberSources,
	type RankedSource,
	type RankingOptions,
	type SourceCandidate,
} from "./citations";
import { createExaSearchService, DEFAULT_EXA_SEARCH_OPTIONS, type ExaSearchOptions, type ExaSearchService, type ExaSearchType } from "./search";
import { ProviderRouter } from "./providers/provider-router";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const DEEP_PLANNER_SYSTEM_PROMPT = `You are a research query planner for an AI search assistant.
Return STRICT JSON only (no markdown, no commentary) matching the provided schema.

Your job:
1) Propose sub-queries that each target a distinct aspect needed to answer the user's question.
2) Ensure sub-queries are specific enough to retrieve useful evidence with web search.
3) Propose an answer outline (headings) for the final response.
4) Propose verification focus items (what could be wrong, what needs cross-checking).
`;

const DEEP_RESEARCHER_SYSTEM_PROMPT = `You are a careful deep research assistant.
Answer using the provided web sources.

Rules:
- Prefer facts supported by the sources. If sources conflict, acknowledge disagreement briefly.
- Cite sources inline using bracketed indices like [1] or [2] that match the numbered source list.
- Never cite a number that was not provided in the source list. Never fabricate URLs.
- If sources are insufficient, say so clearly and answer only what the sources support (you may add clearly-labeled general background without citations).

Output format:
- Use markdown headings and sections to produce a structured response.
- The response must be comprehensive and readable, guided by the supplied answer outline.
`;

function extractJsonObject(raw: string): string {
	const trimmed = raw.trim();
	// Fast path: already JSON.
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("OpenAI output did not contain a JSON object.");
	}
	return trimmed.slice(start, end + 1);
}

const PlanOutputSchema = z.object({
	subQueries: z.array(z.string().min(3).max(200)).min(2).max(6),
	answerOutline: z.array(z.string().min(3).max(80)).min(2).max(8),
	verificationFocus: z.array(z.string().min(3).max(120)).min(1).max(5),
});

type PlanOutput = z.infer<typeof PlanOutputSchema>;

const VerificationOutputSchema = z.object({
	verified: z.boolean(),
	unknownCitationIndices: z.array(z.number().int().positive()).max(25),
	followUpSearches: z.array(z.string().min(3).max(200)).max(2),
	revisionInstructions: z.array(z.string().min(3).max(220)).max(5),
});

type VerificationOutput = z.infer<typeof VerificationOutputSchema>;

import { getResearchPreset } from "./research-presets";

export interface DeepResearchInput {
	readonly query: string;
	readonly abortSignal?: AbortSignal;

	readonly router?: ProviderRouter;
	readonly exa?: ExaSearchService;

	readonly chatHistory?: readonly {
		readonly role: "user" | "assistant";
		readonly content: string;
	}[];

	readonly contextualMemory?: readonly string[];

	readonly search?: Partial<ExaSearchOptions>;
	readonly ranking?: Partial<RankingOptions>;

	readonly model?: string;
	readonly temperature?: number;

	readonly draftMaxCompletionTokens?: number;
	readonly verificationMaxCompletionTokens?: number;
	readonly finalMaxCompletionTokens?: number;

	readonly plan?: {
		readonly maxSubQueries?: number;
		readonly maxFollowUpSearches?: number;
	};

	readonly presetId?: string;
}

export interface DeepResearchStreamResult {
	readonly query: string;
	readonly sources: RankedSource[];
	readonly exaRequestId?: string;
	readonly exaSearchType?: string;
	readonly textStream: AsyncIterable<string>;
}

function assertNonEmptyQuery(q: string): void {
	if (!q.trim()) throw new Error("Deep research requires a non-empty query.");
}

function buildChatMessages(
	options: {
		readonly query: string;
		readonly sources: RankedSource[];
		readonly chatHistory?: readonly {
			readonly role: "user" | "assistant";
			readonly content: string;
		}[];
		readonly contextualMemory?: readonly string[];
		readonly systemPrompt: string;
		readonly extraUserInstructions?: string;
		readonly presetId?: string;
	},
): ChatCompletionMessageParam[] {
	const { sources, query } = options;
	const preset = getResearchPreset(options.presetId);
	const messages: ChatCompletionMessageParam[] = [];

	const systemPrompt = `${options.systemPrompt}\n\nStyle/Preset: ${preset.label}\n${preset.systemPromptModifier}`;
	messages.push({ role: "system", content: systemPrompt });

	if (options.contextualMemory && options.contextualMemory.length > 0) {
		messages.push({
			role: "system",
			content:
				"Relevant long-term user memory (may be partial, use only when applicable):\n\n" +
				options.contextualMemory.map((m, i) => `${i + 1}. ${m}`).join("\n"),
		});
	}

	for (const turn of options.chatHistory ?? []) {
		messages.push({ role: turn.role, content: turn.content });
	}

	const userParts: string[] = [];

	if (sources.length > 0) {
		const { sourcesMarkdown, inlineCitationReminder } = buildCitationContextBlocks(sources);
		userParts.push("## Retrieved sources\n\n" + sourcesMarkdown);
		userParts.push("\n## Instructions\n\n" + inlineCitationReminder);
	} else {
		userParts.push(
			"## Retrieved sources\n\n(No usable sources passed quality filtering. Answer with careful general reasoning; do not invent citations.)",
		);
	}

	if (options.extraUserInstructions?.trim()) {
		userParts.push("\n## Research instructions\n\n" + options.extraUserInstructions.trim());
	}

	userParts.push("\n## Question\n\n" + query.trim());
	messages.push({ role: "user", content: userParts.join("\n") });

	return messages;
}


async function collectRouterText(
	router: ProviderRouter,
	messages: ChatCompletionMessageParam[],
	options: {
		readonly model?: string;
		readonly temperature?: number;
		readonly maxCompletionTokens?: number;
		readonly abortSignal?: AbortSignal;
	},
): Promise<string> {
	async function* gen(): AsyncGenerator<string, void, undefined> {
		yield* router.streamChat(messages, {
			model: options.model,
			temperature: options.temperature,
			maxCompletionTokens: options.maxCompletionTokens,
			abortSignal: options.abortSignal,
		});
	}
	let out = "";
	for await (const part of gen()) {
		out += part;
	}
	return out;
}

function buildPlanningMessages(input: {
	query: string;
	chatHistory?: DeepResearchInput["chatHistory"];
	contextualMemory?: DeepResearchInput["contextualMemory"];
}): ChatCompletionMessageParam[] {
	const parts: string[] = [];
	parts.push("User question:\n" + input.query.trim());

	if (input.chatHistory && input.chatHistory.length > 0) {
		const last = input.chatHistory.slice(-6);
		parts.push(
			"\nRecent conversation turns (oldest -> newest):\n" +
				last.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n"),
		);
	}

	if (input.contextualMemory && input.contextualMemory.length > 0) {
		parts.push(
			"\nRelevant long-term memory snippets (may be partial):\n" +
				input.contextualMemory.map((m, i) => `${i + 1}. ${m}`).join("\n"),
		);
	}

	return [
		{ role: "system", content: DEEP_PLANNER_SYSTEM_PROMPT },
		{
			role: "user",
			content:
				parts.join("\n") +
				`\n\nReturn JSON matching this shape:
{ "subQueries": string[], "answerOutline": string[], "verificationFocus": string[] }`,
		},
	];
}

function buildDraftInstructions(plan: PlanOutput): string {
	const sub = plan.subQueries.map((s, i) => `${i + 1}. ${s}`).join("\n");
	const outline = plan.answerOutline.map((s) => `- ${s}`).join("\n");
	const verifyFocus = plan.verificationFocus.map((s) => `- ${s}`).join("\n");

	return (
		"## Deep research plan\n" +
		(sub ? sub : "(none)") +
		"\n\n## Answer outline\n" +
		outline +
		"\n\n## Verification focus\n" +
		verifyFocus +
		"\n\nWhen answering, use citations to support specific factual claims. Keep the structure aligned to the answer outline."
	);
}

function buildFinalInstructions(
	plan: PlanOutput,
	verification: VerificationOutput,
): string {
	const outline = plan.answerOutline.map((s) => `- ${s}`).join("\n");
	const follow = verification.followUpSearches.length
		? verification.followUpSearches.map((s) => `- ${s}`).join("\n")
		: "- (none)";
	const revision = verification.revisionInstructions.length
		? verification.revisionInstructions.map((s) => `- ${s}`).join("\n")
		: "- (no specific revisions suggested)";

	return (
		"## Answer outline\n" +
		outline +
		"\n\n## Verification pass notes\n" +
		`- verified: ${verification.verified ? "true" : "false"}\n` +
		`- follow-up searches performed:\n${follow}\n` +
		"\n## Revision instructions\n" +
		revision +
		"\n\nNow produce the FINAL answer. Ensure all factual claims derived from sources include inline citations that reference the provided source list."
	);
}

/**
 * Deep research pipeline:
 * - Query planning
 * - Multiple Exa searches
 * - Source deduplication + ranking
 * - Draft answer generation
 * - Verification pass + targeted follow-up searches (optional)
 * - Final answer generation streamed with citations
 */
export async function streamDeepResearchAnswer(
	input: DeepResearchInput,
): Promise<DeepResearchStreamResult> {
	assertNonEmptyQuery(input.query);

	const router = input.router ?? (await ProviderRouter.createDefault());
	const exa = input.exa ?? createExaSearchService();

	const planMaxSubQueries = input.plan?.maxSubQueries ?? 3;
	const maxFollowUpSearches = input.plan?.maxFollowUpSearches ?? 2;

	// 1) Plan sub-queries
	const planningMessages = buildPlanningMessages({
		query: input.query,
		chatHistory: input.chatHistory,
		contextualMemory: input.contextualMemory,
	});

	const planRaw = await collectRouterText(router, planningMessages, {
		model: input.model,
		temperature: input.temperature ?? 0.2,
		maxCompletionTokens: 450,
		abortSignal: input.abortSignal,
	});

	let plan: PlanOutput;
	try {
		plan = PlanOutputSchema.parse(JSON.parse(extractJsonObject(planRaw)));
	} catch (e) {
		throw new Error("Deep research planning failed: invalid JSON output.");
	}

	const subQueries = plan.subQueries.slice(0, planMaxSubQueries);
	if (subQueries.length < 2) {
		throw new Error("Deep research planning returned insufficient sub-queries.");
	}

	// 2) Multiple Exa searches
	const allCandidates: SourceCandidate[] = [];
	const requestIds: string[] = [];
	const searchTypes: string[] = [];

	async function runExaFor(queryText: string): Promise<void> {
		if (input.abortSignal?.aborted) return;

		const searchOpts: Partial<ExaSearchOptions> = {
			...DEFAULT_EXA_SEARCH_OPTIONS,
			...input.search,
			// Deep research mode tends to benefit from a more "thorough" exa retrieval type.
			type: (input.search?.type as ExaSearchType | undefined) ?? "deep-lite",
			numResults: input.search?.numResults ?? 8,
			contents: {
				...DEFAULT_EXA_SEARCH_OPTIONS.contents,
				...input.search?.contents,
				highlightQuery: queryText,
			},
		};

		const retrieved = await exa.search(queryText, searchOpts);
		if (retrieved.requestId) requestIds.push(retrieved.requestId);
		if (retrieved.searchType) searchTypes.push(retrieved.searchType);
		allCandidates.push(...retrieved.candidates);
	}

	await Promise.all(subQueries.map((sq) => runExaFor(sq)));

	// 3) Source deduplication + ranking
	let sources: RankedSource[] = rankFilterAndNumberSources(allCandidates, {
		...input.ranking,
		maxSources: input.ranking?.maxSources ?? 12,
	});

	// 4) Draft answer generation (non-stream)
	const draftMessages = buildChatMessages({
		query: input.query,
		sources,
		chatHistory: input.chatHistory,
		contextualMemory: input.contextualMemory,
		systemPrompt: DEEP_RESEARCHER_SYSTEM_PROMPT,
		extraUserInstructions: buildDraftInstructions(plan),
		presetId: input.presetId,
	});

	const draftText = await collectRouterText(router, draftMessages, {
		model: input.model,
		temperature: input.temperature ?? 0.2,
		maxCompletionTokens: input.draftMaxCompletionTokens ?? 1200,
		abortSignal: input.abortSignal,
	});

	// 5) Verification pass (non-stream) -> optional follow-up searches
	const allowedIndexList = sources.map((s) => ({ index: s.index }));
	const unknownIndices = findUnknownCitationIndices(draftText, allowedIndexList);

	const verificationMessages: ChatCompletionMessageParam[] = [
		{
			role: "system",
			content:
				"You verify that an AI answer correctly uses only the provided citation indices and that its major factual claims are supported by the sources. " +
				"Return STRICT JSON only matching the provided schema.",
		},
		{
			role: "user",
			content:
				`Question:\n${input.query.trim()}\n\n` +
				`Draft answer:\n${draftText}\n\n` +
				`Verification context:\n` +
				`\n- verificationFocus:\n${plan.verificationFocus.map((s) => `- ${s}`).join("\n")}\n` +
				`\n- unknownCitationIndices (computed): ${unknownIndices.join(", ") || "none"}\n\n` +
				`Sources (ranked):\n${buildCitationContextBlocks(sources).sourcesMarkdown}\n\n` +
				`Return JSON of this shape:\n` +
				`{ "verified": boolean, "unknownCitationIndices": number[], "followUpSearches": string[], "revisionInstructions": string[] }`,
		},
	];

	const verificationRaw = await collectRouterText(router, verificationMessages, {
		model: input.model,
		temperature: Math.max(0, (input.temperature ?? 0.2) - 0.1),
		maxCompletionTokens: input.verificationMaxCompletionTokens ?? 650,
		abortSignal: input.abortSignal,
	});

	let verification: VerificationOutput;
	try {
		verification = VerificationOutputSchema.parse(JSON.parse(extractJsonObject(verificationRaw)));
	} catch {
		// If verification JSON parsing fails, fall back to conservative behavior: no follow-up searches.
		verification = {
			verified: unknownIndices.length === 0,
			unknownCitationIndices: unknownIndices,
			followUpSearches: [],
			revisionInstructions: [
				"Re-check citation usage against the provided source list; do not add new citations not present in the list.",
			],
		};
	}

	const followUps = verification.followUpSearches.slice(0, maxFollowUpSearches);
	if (followUps.length > 0) {
		await Promise.all(followUps.map((fu) => runExaFor(fu)));
		sources = rankFilterAndNumberSources(allCandidates, {
			...input.ranking,
			maxSources: input.ranking?.maxSources ?? 12,
		});
	}

	// 6) Final answer streamed
	const finalMessages = buildChatMessages({
		query: input.query,
		sources,
		chatHistory: input.chatHistory,
		contextualMemory: input.contextualMemory,
		systemPrompt: DEEP_RESEARCHER_SYSTEM_PROMPT,
		extraUserInstructions: buildFinalInstructions(plan, verification),
		presetId: input.presetId,
	});

	async function* stream(): AsyncGenerator<string, void, undefined> {
		yield* router.streamChat(finalMessages, {
			model: input.model,
			temperature: input.temperature ?? 0.2,
			maxCompletionTokens: input.finalMaxCompletionTokens,
			abortSignal: input.abortSignal,
		});
	}

	return {
		query: input.query.trim(),
		sources,
		exaRequestId: requestIds[0],
		exaSearchType: searchTypes[0],
		textStream: stream(),
	};
}


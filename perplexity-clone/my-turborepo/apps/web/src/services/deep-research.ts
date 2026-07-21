import { z } from "zod";

import {
	buildCitationContextBlocks,
	findUnknownCitationIndices,
	rankFilterAndNumberSources,
	type RankedSource,
	type RankingOptions,
	type SourceCandidate,
} from "./citations";
import {
	buildMultiEntityPromptInstruction,
	buildSupplementaryQueries,
	detectMultiEntityQuery,
	normalizeMergedCandidateRanks,
} from "./multi-entity-retrieval";
import {
	buildContestedPromptInstruction,
	buildContestedSupplementaryQueries,
	detectContestedQuery,
} from "./contested-query";
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
5) When the user asks about current state, a specific recent year, open challenges, or industry practice (including autonomous agents and similar), include at least one sub-query aimed at practitioner or vendor evidence—such as official docs/APIs, major frameworks, product documentation, or engineering blogs—when that angle is relevant to the question.
`;

const DEEP_RESEARCHER_SYSTEM_PROMPT = `You are a careful deep research assistant. Answer using the provided web sources.

Structure your response as follows:
1. **Summary**: A high-level, 2-3 line quick answer at the very top that answers the question directly.
2. **Key Points**: Use a bulleted list for the most important facts.
3. **Detailed Analysis**: Use structured markdown sections (##) to produce a comprehensive response guided by the supplied answer outline.
4. **Conclusion** (Optional): Do not restate the Summary in the Conclusion. If the conclusion would repeat the Summary, omit it. For standard answers, prefer no Conclusion unless it adds a distinct practical takeaway.

Rules:
- Place citations [1], [2], etc., immediately after the specific sentence or phrase they support.
- Prefer facts supported by the sources. If sources conflict, acknowledge disagreement briefly.
- Never cite a number that was not provided in the source list. Never fabricate URLs.
- If sources are insufficient, say so clearly and answer only what the sources support.
- If the question asks which companies are involved, who the leading companies or key players are, or who the competitors are, compare multiple distinct entities grounded in the sources and avoid letting one company or domain dominate the answer when the sources support a broader landscape.
- Maintain high readability with proper spacing and professional tone.
- For medical/high-stakes health queries:
  - Prefer peer-reviewed, PubMed/PMC, official/regulatory, clinical-trial, or primary sources for clinical efficacy/safety claims.
  - Do not use news/blog sources as primary support for clinical claims when stronger sources are available.
  - If citing a news source, phrase it as "reported by" or "covered by", not "published in".
  - Never name a journal, study, trial, or institution unless that exact name appears in the cited source title, excerpt, URL, or metadata.
  - Do not imply a cited news source is the journal or primary study.
  - Clearly label evidence strength: approved/RCT-backed, peer-reviewed review, observational, post-hoc, preclinical, news report, or uncertain.
  - If evidence is mixed, preliminary, observational, or indirect, say so clearly.
  - Avoid giving personal medical advice and remind users to consult a qualified clinician for decisions.
- Calibrate confidence to the evidence. Do not present forecasts, projections, estimates, or contested claims as certain facts. Use phrases like "some experts estimate", "sources suggest", "evidence points toward", "with significant uncertainty", or "estimates vary".
- For high-stakes domains (health, security, finance, law, safety), explicitly mention uncertainty when evidence is observational, preliminary, contested, or based on projections.
- Prefer ranges over single-point certainty when sources provide ranges.
- Avoid words like “will,” “definitely,” or “likely” unless the cited sources strongly support that confidence.
- In the Summary, include uncertainty when it materially changes the takeaway.

Current practice and "state of the field" questions (e.g. open challenges, a specific year such as 2025, autonomous agents, production-style AI):
- Balance research literature with practitioner ecosystem material when sources support it: official APIs/docs, major frameworks, vendor documentation, engineering blogs, standards and benchmarks.
- The Summary should answer directly. Key Points should be scannable. Detailed Analysis should emphasize tradeoffs, gaps, and current challenges.
- Conclusion must not repeat the Summary. If included, the Conclusion should be 1–2 sentences and must add one of: practical takeaway, uncertainty, decision implication, or next thing to watch.
- Source lines may include a heuristic "Source quality" hint; treat it as weak metadata only—ground claims in the actual excerpts.`;

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

function replaceCandidatesNormalized(pool: SourceCandidate[]): void {
	const normalized = normalizeMergedCandidateRanks(pool);
	pool.length = 0;
	pool.push(...normalized);
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

	const multiEntityActive = detectMultiEntityQuery(input.query);
	const multiEntityPromptBlock = multiEntityActive ? buildMultiEntityPromptInstruction() : "";
	const contestedActive = detectContestedQuery(input.query);
	const contestedPromptBlock = contestedActive ? buildContestedPromptInstruction() : "";

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
	} catch {
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

	if (multiEntityActive) {
		await Promise.all(
			buildSupplementaryQueries(input.query).map(async (sq) => {
				try {
					if (input.abortSignal?.aborted) return;
					const searchOpts: Partial<ExaSearchOptions> = {
						...DEFAULT_EXA_SEARCH_OPTIONS,
						...input.search,
						type: (input.search?.type as ExaSearchType | undefined) ?? "deep-lite",
						numResults: 6,
						contents: {
							...DEFAULT_EXA_SEARCH_OPTIONS.contents,
							...input.search?.contents,
							highlightQuery: sq,
						},
					};
					const retrieved = await exa.search(sq, searchOpts);
					if (retrieved.requestId) requestIds.push(retrieved.requestId);
					if (retrieved.searchType) searchTypes.push(retrieved.searchType);
					allCandidates.push(...retrieved.candidates);
				} catch {
					/* supplementary retrieval failed — keep planner results */
				}
			}),
		);
	}

	if (contestedActive) {
		await Promise.all(
			buildContestedSupplementaryQueries(input.query).map(async (sq) => {
				try {
					if (input.abortSignal?.aborted) return;
					const searchOpts: Partial<ExaSearchOptions> = {
						...DEFAULT_EXA_SEARCH_OPTIONS,
						...input.search,
						type: (input.search?.type as ExaSearchType | undefined) ?? "deep-lite",
						numResults: 6,
						contents: {
							...DEFAULT_EXA_SEARCH_OPTIONS.contents,
							...input.search?.contents,
							highlightQuery: sq,
						},
					};
					const retrieved = await exa.search(sq, searchOpts);
					if (retrieved.requestId) requestIds.push(retrieved.requestId);
					if (retrieved.searchType) searchTypes.push(retrieved.searchType);
					allCandidates.push(...retrieved.candidates);
				} catch {
					/* supplementary retrieval failed — keep planner results */
				}
			}),
		);
	}

	replaceCandidatesNormalized(allCandidates);

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
		extraUserInstructions: [
			buildDraftInstructions(plan),
			multiEntityPromptBlock,
			contestedPromptBlock,
		]
			.filter((s) => s.trim())
			.join("\n\n"),
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
		replaceCandidatesNormalized(allCandidates);
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
		extraUserInstructions: [
			buildFinalInstructions(plan, verification),
			multiEntityPromptBlock,
			contestedPromptBlock,
		]
			.filter((s) => s.trim())
			.join("\n\n"),
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

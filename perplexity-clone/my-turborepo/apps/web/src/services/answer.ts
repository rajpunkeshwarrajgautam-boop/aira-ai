import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	buildCitationContextBlocks,
	rankFilterAndNumberSources,
	type RankedSource,
	type RankingOptions,
	type SourceCandidate,
} from "./citations";
import { ProviderRouter, type ProviderOptions } from "./providers/provider-router";
import {
	buildMultiEntityPromptInstruction,
	buildSupplementaryQueries,
	detectMultiEntityQuery,
	MULTI_ENTITY_SUPPLEMENTARY_NUM_RESULTS,
	normalizeMergedCandidateRanks,
} from "./multi-entity-retrieval";
import {
	buildContestedPromptInstruction,
	buildContestedSupplementaryQueries,
	detectContestedQuery,
} from "./contested-query";
import {
	createExaSearchService,
	DEFAULT_EXA_SEARCH_OPTIONS,
	type ExaSearchOptions,
	type ExaSearchService,
} from "./search";

const SYSTEM_PROMPT = `You are a careful research assistant. Answer the user's question using the provided web sources.

Structure your response as follows:
1. **Summary**: A high-level, 2-3 line quick answer at the very top.
2. **Key Points**: Use a bulleted list for the most important facts.
3. **Detailed Analysis**: Use structured markdown sections (##) for in-depth explanation.

Rules:
- Place citations [1], [2], etc., immediately after the specific sentence or phrase they support. Do not bunch them at the end of paragraphs.
- Prefer facts supported by the sources. If sources conflict, acknowledge the disagreement briefly.
- Never cite a number that was not provided in the source list. Never fabricate URLs.
- If the sources are insufficient, say so clearly and answer only what they support.
- If the question asks which companies are involved, who the leading companies or key players are, or who the competitors are, compare multiple distinct entities grounded in the sources and avoid letting one company or domain dominate the answer when the sources support a broader landscape.
- Maintain professional tone and high readability with proper spacing between paragraphs.

Current practice and "state of the field" questions (e.g. open challenges, a specific year such as 2025, autonomous agents, production-style AI systems):
- Balance academic or survey-style sources with practitioner-facing evidence when the sources include it: official APIs and documentation, widely used frameworks, vendor product/docs pages, engineering blogs, and standards or benchmarks.
- The Summary should answer the question directly. Key Points should be scannable (short bullets, minimal repetition). Detailed Analysis should cover tradeoffs, gaps, and current challenges without restating the same conclusion multiple times.
- Source lines may include a heuristic "Source quality" hint; use it as weak metadata only—ground claims in the actual excerpts.`;

import { getResearchPreset } from "./research-presets";

export interface GroundedAnswerInput {
	/** User question (non-empty). */
	query: string;
	abortSignal?: AbortSignal;
	router?: ProviderRouter;
	exa?: ExaSearchService;
	search?: Partial<ExaSearchOptions>;
	ranking?: Partial<RankingOptions>;
	model?: string;
	temperature?: number;
	maxCompletionTokens?: number;
	/** When true, skip web search and answer from model only (still streaming). */
	disableSearch?: boolean;
	/** Prior chat turns (oldest -> newest) to support follow-up continuity. */
	chatHistory?: readonly {
		readonly role: "user" | "assistant";
		readonly content: string;
	}[];
	/** Additional long-term memory snippets relevant to this question. */
	contextualMemory?: readonly string[];
	/** Optional research preset ID. */
	presetId?: string;
}

export interface GroundedAnswerStreamResult {
	readonly query: string;
	readonly sources: RankedSource[];
	readonly exaRequestId?: string;
	readonly exaSearchType?: string;
	/** Async iterable of assistant markdown/text deltas. */
	readonly textStream: AsyncIterable<string>;
}

function assertNonEmptyQuery(q: string): void {
	if (!q.trim()) {
		throw new Error("Grounded answer requires a non-empty query.");
	}
}

function buildMessages(
	query: string,
	sources: RankedSource[],
	options: {
		readonly searchRan: boolean;
		readonly searchDisabled: boolean;
		readonly chatHistory?: readonly {
			readonly role: "user" | "assistant";
			readonly content: string;
		}[];
		readonly contextualMemory?: readonly string[];
		readonly presetId?: string;
		readonly multiEntityPrompt?: string;
		readonly contestedPrompt?: string;
	},
): ChatCompletionMessageParam[] {
	const preset = getResearchPreset(options.presetId);
	const userParts: string[] = [];

	if (sources.length > 0) {
		const { sourcesMarkdown, inlineCitationReminder } = buildCitationContextBlocks(sources);
		userParts.push("## Retrieved sources\n\n" + sourcesMarkdown);
		userParts.push("\n## Instructions\n\n" + inlineCitationReminder);
		if (options.multiEntityPrompt?.trim()) {
			userParts.push("\n## Additional instructions\n\n" + options.multiEntityPrompt.trim());
		}
		if (options.contestedPrompt?.trim()) {
			userParts.push("\n## Additional instructions\n\n" + options.contestedPrompt.trim());
		}
		userParts.push("\n## Question\n\n" + query.trim());
	} else if (options.searchDisabled) {
		userParts.push(
			"Web search was disabled for this request. Answer using careful general reasoning. " +
				"Do not invent citations or bracketed source numbers.\n\n## Question\n\n" +
				query.trim(),
		);
	} else if (options.searchRan) {
		userParts.push(
			"Search ran but no passages passed quality filtering (duplicates, thin content, or blocked domains may have been removed). " +
				"Answer using careful reasoning; if you are uncertain, say so. " +
				"Do not invent citations or bracketed source numbers.\n\n## Question\n\n" +
				query.trim(),
		);
	} else {
		userParts.push(
			"No web sources were returned for this query. Answer using careful general reasoning. " +
				"Do not invent citations or bracketed source numbers.\n\n## Question\n\n" +
				query.trim(),
		);
	}

	const systemPrompt = `${SYSTEM_PROMPT}\n\nStyle/Preset: ${preset.label}\n${preset.systemPromptModifier}`;
	const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];

	if (options.contextualMemory && options.contextualMemory.length > 0) {
		messages.push({
			role: "system",
			content:
				"Relevant long-term user memory (may be partial, use only when applicable):\n\n" +
				options.contextualMemory.map((m, i) => `${i + 1}. ${m}`).join("\n"),
		});
	}

	for (const turn of options.chatHistory ?? []) {
		messages.push({
			role: turn.role,
			content: turn.content,
		});
	}

	messages.push({ role: "user", content: userParts.join("\n") });
	return messages;
}


/**
 * End-to-end Perplexity-style pipeline: Exa retrieval → ranking → OpenAI streaming answer with citations.
 */
export async function streamGroundedAnswer(
	input: GroundedAnswerInput,
): Promise<GroundedAnswerStreamResult> {
	assertNonEmptyQuery(input.query);
	
	const router = input.router ?? (await ProviderRouter.createDefault());
	const exa = input.exa ?? createExaSearchService();

	let sources: RankedSource[] = [];
	let exaRequestId: string | undefined;
	let exaSearchType: string | undefined;
	let searchRan = false;

	if (!input.disableSearch) {
		searchRan = true;
		const searchOpts: Partial<ExaSearchOptions> = {
			...input.search,
			contents: {
				...DEFAULT_EXA_SEARCH_OPTIONS.contents,
				...input.search?.contents,
				highlightQuery: input.search?.contents?.highlightQuery ?? input.query.trim(),
			},
		};

		const retrieved = await exa.search(input.query, searchOpts);
		exaRequestId = retrieved.requestId;
		exaSearchType = retrieved.searchType;

		let candidates: SourceCandidate[] = [...retrieved.candidates];

		if (detectMultiEntityQuery(input.query)) {
			const supplementaryQueries = buildSupplementaryQueries(input.query);
			const supplementarySettled = await Promise.allSettled(
				supplementaryQueries.map((sq) => {
					const supOpts: Partial<ExaSearchOptions> = {
						...DEFAULT_EXA_SEARCH_OPTIONS,
						...input.search,
						numResults: MULTI_ENTITY_SUPPLEMENTARY_NUM_RESULTS,
						contents: {
							...DEFAULT_EXA_SEARCH_OPTIONS.contents,
							...input.search?.contents,
							highlightQuery: sq,
						},
					};
					return exa.search(sq, supOpts);
				}),
			);
			for (const r of supplementarySettled) {
				if (r.status === "fulfilled") {
					candidates.push(...r.value.candidates);
				}
			}
		}

		if (detectContestedQuery(input.query)) {
			const supplementaryQueries = buildContestedSupplementaryQueries(input.query);
			const supplementarySettled = await Promise.allSettled(
				supplementaryQueries.map((sq) => {
					const supOpts: Partial<ExaSearchOptions> = {
						...DEFAULT_EXA_SEARCH_OPTIONS,
						...input.search,
						numResults: 6,
						contents: {
							...DEFAULT_EXA_SEARCH_OPTIONS.contents,
							...input.search?.contents,
							highlightQuery: sq,
						},
					};
					return exa.search(sq, supOpts);
				}),
			);
			for (const r of supplementarySettled) {
				if (r.status === "fulfilled") {
					candidates.push(...r.value.candidates);
				}
			}
		}

		candidates = normalizeMergedCandidateRanks(candidates);
		sources = rankFilterAndNumberSources(candidates, input.ranking);
	}

	const multiEntityActive = detectMultiEntityQuery(input.query);
	const messages = buildMessages(input.query, sources, {
		searchRan,
		searchDisabled: input.disableSearch === true,
		chatHistory: input.chatHistory,
		contextualMemory: input.contextualMemory,
		presetId: input.presetId,
		multiEntityPrompt: multiEntityActive ? buildMultiEntityPromptInstruction() : undefined,
		contestedPrompt: detectContestedQuery(input.query)
			? buildContestedPromptInstruction()
			: undefined,
	});

	async function* stream(): AsyncGenerator<string, void, undefined> {
		yield* router.streamChat(messages, {
			model: input.model,
			temperature: input.temperature,
			maxCompletionTokens: input.maxCompletionTokens,
			abortSignal: input.abortSignal,
		});
	}

	return {
		query: input.query.trim(),
		sources,
		exaRequestId,
		exaSearchType,
		textStream: stream(),
	};
}

/**
 * Same pipeline as {@link streamGroundedAnswer} but concatenates the full assistant text.
 */
export async function completeGroundedAnswer(
	input: GroundedAnswerInput,
): Promise<{
	text: string;
	sources: RankedSource[];
	exaRequestId?: string;
	exaSearchType?: string;
}> {
	const { textStream, sources, exaRequestId, exaSearchType } = await streamGroundedAnswer(input);
	let text = "";
	for await (const part of textStream) {
		text += part;
	}
	return { text, sources, exaRequestId, exaSearchType };
}

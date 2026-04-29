import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	buildCitationContextBlocks,
	rankFilterAndNumberSources,
	type RankedSource,
	type RankingOptions,
	type SourceCandidate,
} from "./citations";
import { createOpenAIService, OpenAIService, type OpenAIService as OpenAIServiceType } from "./openai";
import {
	createExaSearchService,
	DEFAULT_EXA_SEARCH_OPTIONS,
	type ExaSearchOptions,
	type ExaSearchService,
} from "./search";

const SYSTEM_PROMPT = `You are a careful research assistant. Answer the user's question using the provided web sources.
Rules:
- Prefer facts supported by the sources. If sources conflict, acknowledge the disagreement briefly.
- Cite sources inline using bracketed indices like [1] or [2] that match the numbered source list.
- Never cite a number that was not provided in the source list. Never fabricate URLs.
- If the sources are insufficient, say so clearly and answer only what they support; you may add high-level general knowledge only when clearly separated and labeled as general background (no fake citations).
- Be concise but thorough. Use markdown sections when it improves readability.`;

export interface GroundedAnswerInput {
	/** User question (non-empty). */
	query: string;
	abortSignal?: AbortSignal;
	openai?: OpenAIServiceType;
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
	},
): ChatCompletionMessageParam[] {
	const userParts: string[] = [];

	if (sources.length > 0) {
		const { sourcesMarkdown, inlineCitationReminder } = buildCitationContextBlocks(sources);
		userParts.push("## Retrieved sources\n\n" + sourcesMarkdown);
		userParts.push("\n## Instructions\n\n" + inlineCitationReminder);
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
	const messages: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];

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

	const openaiClient = input.openai ?? createOpenAIService();
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

		const candidates: SourceCandidate[] = retrieved.candidates;
		sources = rankFilterAndNumberSources(candidates, input.ranking);
	}

	const messages = buildMessages(input.query, sources, {
		searchRan,
		searchDisabled: input.disableSearch === true,
		chatHistory: input.chatHistory,
		contextualMemory: input.contextualMemory,
	});

	async function* stream(): AsyncGenerator<string, void, undefined> {
		yield* openaiClient.streamChatText(messages, {
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
	const text = await OpenAIService.collectTextStream(textStream);
	return { text, sources, exaRequestId, exaSearchType };
}

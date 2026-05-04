import axios, { type AxiosInstance } from "axios";
import { z } from "zod";

import type { SourceCandidate } from "./citations";

const EXA_API_BASE = "https://api.exa.ai";

const ExaResultSchema = z.object({
	title: z.string().nullable().optional(),
	url: z.string(),
	id: z.string().optional(),
	publishedDate: z.string().nullable().optional(),
	author: z.string().nullable().optional(),
	text: z.string().optional(),
	highlights: z.array(z.string()).optional(),
	highlightScores: z.array(z.number()).optional(),
	summary: z.string().optional(),
});

const ExaSearchResponseSchema = z.object({
	requestId: z.string().optional(),
	results: z.array(ExaResultSchema),
	searchType: z.string().optional(),
});

export type ExaSearchHit = z.infer<typeof ExaResultSchema>;
export type ExaSearchResponse = z.infer<typeof ExaSearchResponseSchema>;

export type ExaSearchType =
	| "neural"
	| "fast"
	| "auto"
	| "deep-lite"
	| "deep"
	| "deep-reasoning"
	| "instant";

export interface ExaSearchContentsOptions {
	/** Max characters for page text per result (controls cost). */
	textMaxCharacters: number;
	/** Highlight budget for neural summaries of salient passages. */
	highlightMaxCharacters: number;
	/** Optional query steering highlight selection toward the user question. */
	highlightQuery?: string;
}

export interface ExaSearchOptions {
	type: ExaSearchType;
	numResults: number;
	moderation: boolean;
	contents: ExaSearchContentsOptions;
	includeDomains?: string[];
	excludeDomains?: string[];
	startPublishedDate?: string;
	endPublishedDate?: string;
	userLocation?: string;
	category?:
		| "company"
		| "research paper"
		| "news"
		| "personal site"
		| "financial report"
		| "people";
}

export const DEFAULT_EXA_SEARCH_OPTIONS: ExaSearchOptions = {
	type: "auto",
	numResults: 20,
	moderation: true,
	contents: {
		textMaxCharacters: 3500,
		highlightMaxCharacters: 2000,
	},
};

function requireApiKey(explicit?: string): string {
	const key = explicit ?? process.env.EXA_API_KEY;
	if (!key) {
		throw new Error(
			"Exa API key missing: set EXA_API_KEY in the environment or pass apiKey to createExaSearchService.",
		);
	}
	return key;
}

function buildExcerpt(hit: ExaSearchHit): string {
	if (hit.summary?.trim()) return hit.summary.trim();
	const hl = hit.highlights?.map((h) => h.trim()).filter(Boolean) ?? [];
	if (hl.length) return hl.join("\n\n");
	const body = hit.text?.trim();
	if (body) return body;
	return "";
}

function safeTitle(hit: ExaSearchHit, fallbackUrl: string): string {
	const t = hit.title?.trim();
	if (t) return t;
	try {
		return new URL(fallbackUrl).hostname;
	} catch {
		return fallbackUrl;
	}
}

export function mapExaHitsToSourceCandidates(hits: readonly ExaSearchHit[]): SourceCandidate[] {
	return hits.map((hit, originalRank) => {
		const url = hit.url.trim();
		return {
			url,
			title: safeTitle(hit, url),
			publishedDate: hit.publishedDate ?? null,
			excerpt: buildExcerpt(hit),
			summary: hit.summary,
			highlightScores: hit.highlightScores,
			originalRank,
		};
	});
}

export interface ExaSearchExecutionResult {
	readonly requestId?: string;
	readonly searchType?: string;
	readonly hits: ExaSearchHit[];
	readonly candidates: SourceCandidate[];
}

export class ExaSearchService {
	private readonly http: AxiosInstance;

	constructor(private readonly apiKey: string) {
		this.http = axios.create({
			baseURL: EXA_API_BASE,
			timeout: 60_000,
			headers: {
				"x-api-key": this.apiKey,
				"Content-Type": "application/json",
			},
			validateStatus: (s) => s < 500,
		});
	}

	async search(query: string, partial: Partial<ExaSearchOptions> = {}): Promise<ExaSearchExecutionResult> {
		const opts: ExaSearchOptions = {
			...DEFAULT_EXA_SEARCH_OPTIONS,
			...partial,
			contents: {
				...DEFAULT_EXA_SEARCH_OPTIONS.contents,
				...partial.contents,
			},
		};

		const body: Record<string, unknown> = {
			query: query.trim(),
			type: opts.type,
			numResults: opts.numResults,
			moderation: opts.moderation,
			contents: {
				text: { maxCharacters: opts.contents.textMaxCharacters },
				highlights: {
					maxCharacters: opts.contents.highlightMaxCharacters,
					...(opts.contents.highlightQuery
						? { query: opts.contents.highlightQuery }
						: {}),
				},
			},
		};

		if (opts.includeDomains?.length) body.includeDomains = opts.includeDomains;
		if (opts.excludeDomains?.length) body.excludeDomains = opts.excludeDomains;
		if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;
		if (opts.endPublishedDate) body.endPublishedDate = opts.endPublishedDate;
		if (opts.userLocation) body.userLocation = opts.userLocation;
		if (opts.category) body.category = opts.category;

		const res = await this.http.post("/search", body);

		if (res.status !== 200) {
			const detail =
				typeof res.data === "object" && res.data && "error" in res.data
					? JSON.stringify(res.data)
					: String(res.data ?? "");
			throw new Error(`Exa search failed (${res.status}): ${detail}`);
		}

		const parsed = ExaSearchResponseSchema.safeParse(res.data);
		if (!parsed.success) {
			throw new Error(`Exa search response schema mismatch: ${parsed.error.message}`);
		}

		const candidates = mapExaHitsToSourceCandidates(parsed.data.results);
		return {
			requestId: parsed.data.requestId,
			searchType: parsed.data.searchType,
			hits: parsed.data.results,
			candidates,
		};
	}
}

export function createExaSearchService(apiKey?: string): ExaSearchService {
	return new ExaSearchService(requireApiKey(apiKey));
}

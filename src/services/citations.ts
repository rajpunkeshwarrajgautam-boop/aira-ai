import { z } from "zod";

/**
 * Canonical shape for a retrieved URL before ranking and citation numbering.
 * Produced by the search service from Exa results.
 */
export interface SourceCandidate {
	readonly url: string;
	readonly title: string;
	readonly publishedDate: string | null;
	/** Best-effort passage used as grounding context (highlights, summary, or truncated body). */
	readonly excerpt: string;
	readonly summary?: string;
	readonly highlightScores?: readonly number[];
	/** Zero-based position from the search API (primary relevance prior). */
	readonly originalRank: number;
}

const RankedSourceSchema = z.object({
	index: z.number().int().positive(),
	url: z.string().min(1),
	title: z.string(),
	publishedDate: z.string().nullable(),
	excerpt: z.string(),
	compositeScore: z.number(),
});

export type RankedSource = z.infer<typeof RankedSourceSchema>;

export interface RankingOptions {
	/** Maximum sources kept after ranking (default 8). */
	maxSources: number;
	/** Skip domains (hostname match, lowercase). */
	excludeDomains: ReadonlySet<string>;
	/** Minimum excerpt length in characters after trim (default 80). */
	minExcerptLength: number;
	/** Weight for API ordering vs. snippet richness vs. recency (must sum to 1 for normalized interpretation). */
	weights: {
		order: number;
		snippet: number;
		recency: number;
	};
}

export const DEFAULT_RANKING_OPTIONS: RankingOptions = {
	maxSources: 8,
	excludeDomains: new Set([
		"pinterest.com",
		"pinterest.de",
		"facebook.com",
		"instagram.com",
		"tiktok.com",
	]),
	minExcerptLength: 80,
	weights: {
		order: 0.5,
		snippet: 0.3,
		recency: 0.2,
	},
};

function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return "";
	}
}

function normalizeCanonicalUrl(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		u.pathname = u.pathname.replace(/\/$/, "") || "/";
		return u.toString();
	} catch {
		return url.trim();
	}
}

function excerptRichness(excerpt: string): number {
	const t = excerpt.trim();
	if (t.length === 0) return 0;
	return Math.min(1, Math.log10(10 + t.length) / Math.log10(10 + 4000));
}

function avgHighlightScore(scores: readonly number[] | undefined): number {
	if (!scores?.length) return 0;
	const sum = scores.reduce((a, b) => a + b, 0);
	return Math.max(0, Math.min(1, sum / scores.length));
}

function recencyScore(isoDate: string | null, nowMs: number): number {
	if (!isoDate) return 0.35;
	const t = Date.parse(isoDate);
	if (Number.isNaN(t)) return 0.35;
	const ageDays = (nowMs - t) / (86_400_000);
	// Recent pages score toward 1; very old toward 0
	return Math.max(0, Math.min(1, 1 - Math.min(ageDays, 365 * 5) / (365 * 5)));
}

function orderPrior(originalRank: number, poolSize: number): number {
	if (poolSize <= 1) return 1;
	return (poolSize - 1 - originalRank) / (poolSize - 1);
}

/**
 * Deduplicate by canonical URL, drop blocked domains and thin excerpts,
 * then rank by a weighted composite of API order, snippet strength, highlight similarity, and recency.
 */
export function rankFilterAndNumberSources(
	candidates: readonly SourceCandidate[],
	partial: Partial<RankingOptions> = {},
): RankedSource[] {
	const opts: RankingOptions = { ...DEFAULT_RANKING_OPTIONS, ...partial };
	const w = opts.weights;
	const wSum = w.order + w.snippet + w.recency;
	const now = Date.now();

	const seen = new Set<string>();
	const filtered: SourceCandidate[] = [];

	for (const c of candidates) {
		const canonical = normalizeCanonicalUrl(c.url);
		if (seen.has(canonical)) continue;
		const host = hostnameOf(c.url);
		if (host && opts.excludeDomains.has(host)) continue;
		const excerpt = c.excerpt.trim();
		if (excerpt.length < opts.minExcerptLength) continue;
		seen.add(canonical);
		filtered.push({ ...c, url: canonical });
	}

	const n = filtered.length;
	const scored = filtered.map((c) => {
		const op = orderPrior(c.originalRank, n);
		const rich = excerptRichness(c.excerpt);
		const hl = avgHighlightScore(c.highlightScores);
		const snippetScore = 0.65 * rich + 0.35 * hl;
		const rec = recencyScore(c.publishedDate, now);
		const composite =
			((w.order * op + w.snippet * snippetScore + w.recency * rec) / wSum) *
			1000;

		return { c, compositeScore: composite };
	});

	scored.sort((a, b) => b.compositeScore - a.compositeScore);

	const top = scored.slice(0, opts.maxSources);

	return top.map((row, i) =>
		RankedSourceSchema.parse({
			index: i + 1,
			url: row.c.url,
			title: row.c.title.trim() || hostnameOf(row.c.url) || row.c.url,
			publishedDate: row.c.publishedDate,
			excerpt: row.c.excerpt.trim(),
			compositeScore: row.compositeScore,
		}),
	);
}

export interface CitationContextBlocks {
	/** Full markdown-style block list for the model context window. */
	sourcesMarkdown: string;
	/** Short reminder appended near user instructions. */
	inlineCitationReminder: string;
}

export function buildCitationContextBlocks(sources: readonly RankedSource[]): CitationContextBlocks {
	const lines: string[] = [];
	for (const s of sources) {
		const datePart = s.publishedDate ? ` (${s.publishedDate})` : "";
		lines.push(`### [${s.index}] ${s.title}${datePart}`);
		lines.push(`URL: ${s.url}`);
		lines.push("");
		lines.push(s.excerpt);
		lines.push("");
	}

	const sourcesMarkdown = lines.join("\n").trim();

	const inlineCitationReminder =
		"When you state facts from these sources, cite them inline using bracketed numbers that match the source list, e.g. [1] or [1][3]. " +
		"Only cite numbers that exist in the provided source list. Do not invent URLs or new citation numbers.";

	return { sourcesMarkdown, inlineCitationReminder };
}

/** Regex to find bracket citations like [1] or [12] in model output (for post-validation). */
export const BRACKET_CITATION_PATTERN = /\[(\d{1,4})\]/g;

export function parseCitationIndicesFromAnswer(answer: string): number[] {
	const out = new Set<number>();
	let m: RegExpExecArray | null;
	const re = new RegExp(BRACKET_CITATION_PATTERN.source, "g");
	while ((m = re.exec(answer)) !== null) {
		out.add(Number.parseInt(m[1]!, 10));
	}
	return [...out].sort((a, b) => a - b);
}

/**
 * Returns citation indices that are not present in the supplied sources (quality guard).
 */
export function findUnknownCitationIndices(
	answer: string,
	sources: Pick<RankedSource, "index">[],
): number[] {
	const allowed = new Set(sources.map((s) => s.index));
	const used = parseCitationIndicesFromAnswer(answer);
	return used.filter((i) => !allowed.has(i));
}

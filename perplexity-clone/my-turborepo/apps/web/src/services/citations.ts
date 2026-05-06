import { z } from "zod";

import {
	inferSourceQualityLabel,
	sanitizeSourceExcerpt,
	type SourceQualityLabel,
} from "./source-quality";

const SOURCE_QUALITY_PRIORITY: Record<SourceQualityLabel, number> = {
	"Peer-reviewed": 7,
	"Official": 6,
	"Preprint": 5,
	"Aggregator": 4,
	"Blog": 3,
	"Company": 2,
	"Unknown": 1,
};

function extractSourceIdentifier(url: string): string | null {
	try {
		const decoded = decodeURIComponent(url).toLowerCase();

		// arXiv: detect in path or as arxiv:<id>
		const arxivMatch =
			decoded.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i) ||
			decoded.match(/arxiv:(\d{4}\.\d{4,5})/i);
		if (arxivMatch?.[1]) return `arxiv:${arxivMatch[1]}`;

		// DOI: detect 10.xxxx/... pattern
		const doiMatch = decoded.match(/(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i);
		if (doiMatch?.[1]) return `doi:${doiMatch[1].replace(/\/$/, "")}`;

		return null;
	} catch {
		return null;
	}
}

/**
 * Normalizes research paper titles to a canonical key to catch mirrors across domains.
 * Uses exact match only to avoid false merges.
 * v3: Strips arXiv ID prefixes and common scholarly platform suffixes.
 */
function normalizeTitleKey(title: string): string | null {
	let t = title.trim().toLowerCase();
	if (!t) return null;

	// 1. Strip bracketed arXiv-style ID prefixes: [2304.15004], [cs.CL/2304.15004], etc.
	t = t.replace(/^\[[^\]]+\]\s*/, "");

	// 2. Improve trailing platform suffix cleanup after common separators: -, |, :, —
	// Only strips when they appear as trailing markers.
	t = t.replace(/\s*[-|:—]\s*(?:acm digital library|arxiv|neurips|researchgate|science\s*direct|nature|ieee\s*xplore|openreview|proceedings)\s*$/g, "");

	// 3. Final normalization: remove remaining punctuation and collapse whitespace
	const normalized = t
		.replace(/[^\w\s]/g, "") // Remove all non-word/non-space punctuation
		.replace(/\s+/g, " ") // Collapse multiple spaces
		.trim();

	// Only deduplicate by title if it is long enough to be unique (e.g. not "Introduction")
	// and after normalization still carries significant entropy.
	if (normalized.length <= 20) return null;

	return normalized;
}

/**
 * Returns all possible identity keys for a candidate source.
 * Multiple keys allow union-based deduplication: if ANY key matches a
 * previously seen paper, the candidate is treated as a duplicate.
 * v4: Fixes the single-key OR-fallback that allowed the same paper
 * to survive under different DOI strings or arXiv vs title keys.
 */
function getAllPaperKeys(url: string, title: string): string[] {
	const keys: string[] = [];
	const urlId = extractSourceIdentifier(url);
	if (urlId) keys.push(urlId);
	const titleKey = normalizeTitleKey(title);
	if (titleKey) keys.push(`title:${titleKey}`);
	return keys;
}

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
 * Simple registrable-domain key: for 3+ hostname segments, use the last two labels
 * (e.g. `investors.crisprtx.com` → `crisprtx.com`). Two-part hosts stay as-is (`nih.gov`).
 */
function registrableDomainKey(host: string): string {
	const h = host.replace(/^www\./, "").toLowerCase().trim();
	if (!h) return "";
	const parts = h.split(".").filter(Boolean);
	if (parts.length <= 2) return h;
	return parts.slice(-2).join(".");
}

const HIGH_AUTHORITY_REGISTRABLE = new Set([
	"nature.com",
	"nih.gov",
	"fda.gov",
	"sec.gov",
	"clinicaltrials.gov",
]);

function maxSourcesPerRegistrableDomain(domainKey: string): number {
	return HIGH_AUTHORITY_REGISTRABLE.has(domainKey) ? 3 : 2;
}

/** Soft down-rank for IR / press-release style pages (not excluded). */
const INVESTOR_RELATIONS_SCORE_FACTOR = 0.88;

function investorRelationsScoreFactor(url: string): number {
	try {
		const u = new URL(url);
		const host = u.hostname.toLowerCase();
		const path = u.pathname.toLowerCase();
		if (host.startsWith("ir.")) return INVESTOR_RELATIONS_SCORE_FACTOR;
		if (host.startsWith("investors.")) return INVESTOR_RELATIONS_SCORE_FACTOR;
		if (path.includes("investor-relations")) return INVESTOR_RELATIONS_SCORE_FACTOR;
		if (path.includes("/investors")) return INVESTOR_RELATIONS_SCORE_FACTOR;
		if (path.includes("/news-releases")) return INVESTOR_RELATIONS_SCORE_FACTOR;
		return 1;
	} catch {
		return 1;
	}
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

	const seenUrls = new Set<string>();
	/**
	 * Multi-key identity map: each paper key (arXiv ID, DOI, title) points to the
	 * same shared entry object. If ANY key matches, the candidate is a duplicate.
	 * v4: Fixes single-key OR-fallback that let the same paper survive under
	 * different DOI strings (arXiv DOI vs ACM DOI) or arXiv vs title keys.
	 */
	const seenPapers = new Map<string, { c: SourceCandidate; quality: SourceQualityLabel }>();
	const filtered: SourceCandidate[] = [];

	for (const c of candidates) {
		const canonical = normalizeCanonicalUrl(c.url);
		const host = hostnameOf(c.url);
		if (host && opts.excludeDomains.has(host)) continue;
		const excerpt = sanitizeSourceExcerpt(c.excerpt);
		if (excerpt.length < opts.minExcerptLength) continue;

		const keys = getAllPaperKeys(c.url, c.title);
		const quality = inferSourceQualityLabel(c.url, c.title);

		if (keys.length > 0) {
			// Check if ANY key already has an entry (union lookup)
			let existing: { c: SourceCandidate; quality: SourceQualityLabel } | undefined;
			for (const k of keys) {
				existing = seenPapers.get(k);
				if (existing) break;
			}

			if (!existing) {
				// New paper — register all keys pointing to the same shared entry
				const entry = { c: { ...c, url: canonical, excerpt }, quality };
				for (const k of keys) seenPapers.set(k, entry);
			} else {
				// Duplicate — upgrade quality if better, preserve earliest rank
				if (SOURCE_QUALITY_PRIORITY[quality] > SOURCE_QUALITY_PRIORITY[existing.quality]) {
					const bestRank = Math.min(existing.c.originalRank, c.originalRank);
					existing.c = { ...c, url: canonical, excerpt, originalRank: bestRank };
					existing.quality = quality;
				} else {
					existing.c = { ...existing.c, originalRank: Math.min(existing.c.originalRank, c.originalRank) };
				}
				// Register any NEW keys so future candidates also dedupe
				for (const k of keys) {
					if (!seenPapers.has(k)) seenPapers.set(k, existing);
				}
			}
			continue;
		}

		if (seenUrls.has(canonical)) continue;
		seenUrls.add(canonical);
		filtered.push({ ...c, url: canonical, excerpt });
	}

	// Merge unique paper-based sources back into filtered list (deduplicate shared refs)
	const addedPaperEntries = new Set<{ c: SourceCandidate; quality: SourceQualityLabel }>();
	for (const entry of seenPapers.values()) {
		if (addedPaperEntries.has(entry)) continue;
		addedPaperEntries.add(entry);
		if (!seenUrls.has(entry.c.url)) {
			filtered.push(entry.c);
			seenUrls.add(entry.c.url);
		}
	}


	const n = filtered.length;
	const scored = filtered.map((c) => {
		const op = orderPrior(c.originalRank, n);
		const rich = excerptRichness(c.excerpt);
		const hl = avgHighlightScore(c.highlightScores);
		const snippetScore = 0.65 * rich + 0.35 * hl;
		const rec = recencyScore(c.publishedDate, now);
		let composite =
			((w.order * op + w.snippet * snippetScore + w.recency * rec) / wSum) *
			1000;
		composite *= investorRelationsScoreFactor(c.url);

		return { c, compositeScore: composite };
	});

	scored.sort((a, b) => b.compositeScore - a.compositeScore);

	const domainCounts = new Map<string, number>();
	const top: typeof scored = [];
	for (const row of scored) {
		if (top.length >= opts.maxSources) break;
		const host = hostnameOf(row.c.url);
		const domainKey = registrableDomainKey(host) || host || "_";
		const cap = maxSourcesPerRegistrableDomain(domainKey);
		const used = domainCounts.get(domainKey) ?? 0;
		if (used >= cap) continue;
		domainCounts.set(domainKey, used + 1);
		top.push(row);
	}

	return top.map((row, i) =>
		RankedSourceSchema.parse({
			index: i + 1,
			url: row.c.url,
			title: row.c.title.trim() || hostnameOf(row.c.url) || row.c.url,
			publishedDate: row.c.publishedDate,
			excerpt: sanitizeSourceExcerpt(row.c.excerpt),
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
		const quality = inferSourceQualityLabel(s.url, s.title);
		lines.push(`### [${s.index}] ${s.title}${datePart}`);
		lines.push(`URL: ${s.url}`);
		lines.push(`Source quality (heuristic): ${quality}`);
		lines.push("");
		lines.push(sanitizeSourceExcerpt(s.excerpt));
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

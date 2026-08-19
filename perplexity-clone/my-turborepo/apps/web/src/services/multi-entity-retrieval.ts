import type { SourceCandidate } from "./citations";

const MULTI_ENTITY_PATTERN =
	/which companies|leading companies|key players|competitors|top companies/i;

const TRIGGER_PHRASES = [
	"which companies",
	"leading companies",
	"key players",
	"competitors",
	"top companies",
] as const;

/** Results per supplementary Exa search. */
export const MULTI_ENTITY_SUPPLEMENTARY_NUM_RESULTS = 6;

export function detectMultiEntityQuery(query: string): boolean {
	return MULTI_ENTITY_PATTERN.test(query.trim());
}

/**
 * Simple topic phrase: trim query and strip trigger phrases (case-insensitive).
 */
export function extractTopicPhrase(query: string): string {
	let t = query.trim().replace(/\s+/g, " ");
	if (!t) return "";

	for (const phrase of TRIGGER_PHRASES) {
		const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		t = t.replace(re, " ").replace(/\s+/g, " ").trim();
	}

	if (!t) t = query.trim();
	if (t.length > 200) return `${t.slice(0, 199)}…`;
	return t;
}

/**
 * Deterministic supplementary queries (no LLM). Only used when {@link detectMultiEntityQuery} is true.
 */
export function buildSupplementaryQueries(query: string): string[] {
	const topic = extractTopicPhrase(query);
	return [
		`${topic} Intellia Editas Beam Verve Caribou Vertex Prime Medicine clinical trials`,
		`${topic} clinicaltrials.gov gene therapy companies`,
		`${topic} review clinical trials landscape key companies`,
	];
}

export function buildMultiEntityPromptInstruction(): string {
	return [
		"For questions about companies, competitors, or key players, you must include a markdown table.",
		"Do not replace the table with bullets or prose.",
		"",
		"Place it under **Detailed Analysis** using this exact subsection heading (including capitalization):",
		"",
		"### Leading companies",
		"",
		"Immediately under that heading, output this exact markdown table structure (header row, then separator row, then your data rows):",
		"",
		"| Company | Therapy/Program | Approach | Trial stage | Evidence/source |",
		"|---|---|---|---|---|",
		"",
		"Data rows:",
		"- When retrieved sources support at least one company, include at least one data row.",
		"- Add additional rows for other companies the sources clearly support.",
		"- If a cell cannot be filled from retrieved sources, write exactly: Not specified in retrieved sources",
		"",
		"Evidence/source column:",
		"- Must include citation numbers like [1], [2] that appear in the provided source list only.",
		"- Do not cite unsupported claims.",
		"",
		"Other rules:",
		"- Do not invent companies not clearly supported by the sources.",
		"- Compare multiple distinct companies when the sources support them.",
		"- Avoid over-focusing on one company or domain when the sources support a broader landscape.",
	].join("\n");
}

/**
 * Preserve each search batch's native rank instead of flattening independent batches into
 * one sequential list. Supplementary primary-source searches otherwise receive an artificial
 * relevance penalty simply because they were appended after the initial broad search.
 */
export function normalizeMergedCandidateRanks(
	candidates: readonly SourceCandidate[],
): SourceCandidate[] {
	return candidates.map((c) => ({
		...c,
		originalRank:
			Number.isFinite(c.originalRank) && c.originalRank >= 0
				? c.originalRank
				: 0,
	}));
}

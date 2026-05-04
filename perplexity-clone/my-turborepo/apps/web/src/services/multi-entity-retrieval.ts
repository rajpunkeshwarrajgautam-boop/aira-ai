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
		"For questions about companies, competitors, or key players, include a **Leading companies** section with a markdown table:",
		"",
		"| Company | Therapy/Program | Approach | Trial stage | Evidence/source |",
		"| --- | --- | --- | --- | --- |",
		"",
		"Rules:",
		"- Use citation numbers in the Evidence/source column (e.g. [1][3]) that match the provided source list only.",
		"- Do not list companies not clearly supported by the sources.",
		"- Avoid over-focusing on one company if the sources support a broader landscape.",
	].join("\n");
}

/**
 * Re-assign originalRank sequentially so merged batches get a consistent order prior in ranking.
 */
export function normalizeMergedCandidateRanks(
	candidates: readonly SourceCandidate[],
): SourceCandidate[] {
	return candidates.map((c, i) => ({
		...c,
		originalRank: i,
	}));
}

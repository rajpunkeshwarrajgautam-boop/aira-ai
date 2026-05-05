const CONTESTED_QUERY_PATTERN =
	/\b(?:for and against|evidence for and against|arguments for|arguments against|debate|controversy|contested|disputed|disagreement)\b/i;

export function detectContestedQuery(query: string): boolean {
	return CONTESTED_QUERY_PATTERN.test(query.trim());
}

/**
 * Deterministic supplementary queries to retrieve both sides of a debate.
 */
export function buildContestedSupplementaryQueries(query: string): string[] {
	const q = query.trim();
	return [
		`${q} evidence supporting arguments`,
		`${q} evidence against criticism response`,
	];
}

export function buildContestedPromptInstruction(): string {
	return [
		"For contested or debated topics, do not present one side as settled unless sources overwhelmingly support it.",
		"Structure your response with these specific sections under **Detailed Analysis**:",
		"",
		"- **Evidence supporting**: Summary of arguments and data supporting the primary claim or one side.",
		"- **Evidence against**: Summary of opposing views, criticisms, or counter-data.",
		"- **What remains uncertain**: Gaps in current research or unresolved aspects.",
		"- **Implications**: Potential impact on alignment, governance, or policy when relevant to the topic.",
		"",
		"Ensure you use citations [1], [2], etc., in each of these sections.",
	].join("\n");
}

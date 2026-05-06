const CONTESTED_QUERY_PATTERN =
	/\b(?:for and against|evidence for and against|arguments for|arguments against|debate|controversy|contested|disputed|disagreement)\b/i;

export function detectContestedQuery(query: string): boolean {
	return CONTESTED_QUERY_PATTERN.test(query.trim());
}

const GOVERNANCE_KEYWORDS = [
	"governance",
	"alignment",
	"policy",
	"regulation",
	"safety",
	"eval",
	"evaluation",
	"oversight",
	"frontier model",
	"deployment threshold",
];

/**
 * Deterministic supplementary queries to retrieve both sides of a debate.
 * v3: Adds a targeted governance/alignment query if keywords match.
 */
export function buildContestedSupplementaryQueries(query: string): string[] {
	const q = query.trim();
	const queries = [
		`${q} evidence supporting arguments`,
		`${q} evidence against criticism response`,
	];

	const lowerQ = q.toLowerCase();
	if (GOVERNANCE_KEYWORDS.some((kw) => lowerQ.includes(kw))) {
		queries.push(`${q} AI alignment governance policy regulation safety evaluation mechanisms`);
	}

	return queries.slice(0, 3);
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
		"  - When sources support them, discuss concrete mechanisms: eval-based governance, frontier model evaluations, deployment thresholds, compute/capability monitoring, or scalable oversight.",
		"  - Do not invent mechanisms unsupported by sources. If sources provide limited evidence for governance, explicitly state that the retrieved sources offer thin evidence for specific policy implications.",
		"",
		"Ensure you use citations [1], [2], etc., in each of these sections.",
	].join("\n");
}

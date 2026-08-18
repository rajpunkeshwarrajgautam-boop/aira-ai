export type AgenticRetrievalMode = "reasoning" | "focused" | "agentic";

export interface AgenticAnswerPlan {
	readonly retrievalMode: AgenticRetrievalMode;
	readonly supplementaryQueries: readonly string[];
	readonly advisorInstruction: string;
}

const CURRENT_RE = /\b(latest|current|today|now|recent|news|price|prices|availability|available|release|released|version|update|updated|202[5-9]|market|trend|forecast|outlook|schedule|law|rule|regulation|policy)\b/i;
const DECISION_RE = /\b(should i|what should i|what would you|recommend|recommendation|best|better|choose|which one|worth it|good idea|bad idea|pros and cons|trade-?off|strategy|plan|how should|what is the best way)\b/i;
const PROBLEM_SOLVING_RE = /\b(fix|solve|solution|why is|why does|how do i|how can i|not working|error|issue|problem|stuck|optimi[sz]e|improve|reduce|increase|grow|build|launch|debug|diagnose)\b/i;
const HIGH_STAKES_RE = /\b(medical|medicine|medication|health|doctor|legal|lawyer|tax|finance|financial|investment|invest|loan|insurance|security|cybersecurity|safety|contract|compliance)\b/i;
const ARGUMENT_RE = /\b(argue|argument|counterargument|debate|case for|case against|why not|downsides?|risks?|limitations?|critique|challenge)\b/i;
const PURE_GENERATION_RE = /\b(write|rewrite|draft|rephrase|translate|translation|poem|story|caption|email|letter|tagline|bio)\b/i;
const EXPLICIT_RESEARCH_RE = /\b(search|research|sources?|evidence|verify|fact-?check|look up|find out)\b/i;

function uniqueQueries(queries: readonly string[], original: string): string[] {
	const seen = new Set<string>([original.trim().toLowerCase()]);
	const out: string[] = [];
	for (const candidate of queries) {
		const q = candidate.trim().replace(/\s+/g, " ");
		if (q.length < 3) continue;
		const key = q.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(q);
	}
	return out.slice(0, 3);
}

function buildSupplementaryQueries(query: string): string[] {
	const year = new Date().getUTCFullYear();
	const queries: string[] = [];

	if (CURRENT_RE.test(query) || HIGH_STAKES_RE.test(query)) {
		queries.push(`${query} official primary source ${year}`);
	}
	if (DECISION_RE.test(query) || ARGUMENT_RE.test(query)) {
		queries.push(`${query} risks limitations counterarguments alternatives`);
	}
	if (PROBLEM_SOLVING_RE.test(query) || DECISION_RE.test(query)) {
		queries.push(`${query} practical solution implementation steps best practice`);
	}
	if (queries.length === 0) {
		queries.push(`${query} authoritative source evidence`);
	}
	return uniqueQueries(queries, query);
}

export const AIRA_AGENTIC_ADVISOR_BEHAVIOR = `## AIRA agentic answer behavior
Use the web as evidence, not as the product. Your job is to solve the user's real problem like an excellent senior human advisor who can research in real time.
- Lead with the answer, recommendation, diagnosis, or decision that is most useful to the user. Do not begin by narrating the search process.
- Synthesize across evidence instead of producing a source-by-source summary. Explain what the evidence means for this user's question.
- When the user is choosing or asking for advice, make a recommendation when the evidence supports one. State the assumptions that would change it.
- Give the strongest material argument or counterargument when it could change the decision. Do not manufacture a debate when the answer is straightforward.
- For problems and troubleshooting, move from likely cause -> best fix -> verification. Prefer concrete steps over generic advice.
- For business, strategy, product, buying, coding, or planning questions, identify the practical consequence: what to do, what to avoid, and what to watch next.
- Distinguish verified facts from inference and professional judgment. Be decisive where justified, but do not hide meaningful uncertainty.
- Use the user's conversation history and relevant memory to personalize the recommendation when applicable, without repeating known context back unnecessarily.
- Do not overwhelm the user with every caveat, every source, or a giant checklist. Include only decision-relevant detail.
- Ask a clarifying question only when proceeding would likely produce the wrong recommendation. Otherwise make a reasonable assumption and continue.
- When useful, end with at most two concrete next-step suggestions. Do not end every response with generic offers such as "let me know if you want more".
- Never confuse popularity, SEO ranking, or repeated claims across websites with truth. Weight primary and authoritative evidence more heavily.
- If live evidence changes or contradicts common knowledge, use the current evidence and make the conflict explicit.
- For high-stakes health, legal, financial, security, or safety questions, keep the answer practical while making material limitations and uncertainty clear.`;

export function buildAgenticAnswerPlan(query: string): AgenticAnswerPlan {
	const q = query.trim();
	const wordCount = q.split(/\s+/).filter(Boolean).length;
	const pureGeneration = PURE_GENERATION_RE.test(q) && !EXPLICIT_RESEARCH_RE.test(q) && !CURRENT_RE.test(q);

	if (pureGeneration) {
		return {
			retrievalMode: "reasoning",
			supplementaryQueries: [],
			advisorInstruction: AIRA_AGENTIC_ADVISOR_BEHAVIOR,
		};
	}

	const substantive =
		CURRENT_RE.test(q) ||
		DECISION_RE.test(q) ||
		PROBLEM_SOLVING_RE.test(q) ||
		HIGH_STAKES_RE.test(q) ||
		ARGUMENT_RE.test(q) ||
		EXPLICIT_RESEARCH_RE.test(q) ||
		wordCount >= 14;

	return {
		retrievalMode: substantive ? "agentic" : "focused",
		supplementaryQueries: substantive ? buildSupplementaryQueries(q) : [],
		advisorInstruction: AIRA_AGENTIC_ADVISOR_BEHAVIOR,
	};
}

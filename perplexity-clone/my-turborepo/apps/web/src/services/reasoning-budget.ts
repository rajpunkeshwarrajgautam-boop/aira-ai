export interface ReasoningBudget {
	readonly tier: "default" | "balanced" | "deep";
	readonly maxCompletionTokens?: number;
	readonly verifierMaxCompletionTokens?: number;
	readonly instruction: string;
}

const COMPLEXITY_TERMS = /\b(analy[sz]e|compare|architecture|debug|prove|derive|trade-?off|strategy|plan|investigate|root cause|design|optimi[sz]e|benchmark|security|legal|medical|financial)\b/i;
const MULTISTEP_TERMS = /\b(first|second|then|after|before|step|phase|option|alternative|counterargument|verify|evidence)\b/i;

export function getReasoningBudget(query: string, retrievalMode: string): ReasoningBudget {
	if (process.env.ADAPTIVE_REASONING_ENABLED !== "true") {
		return { tier: "default", instruction: "Use only the reasoning depth needed for the request; do not expose private chain-of-thought." };
	}
	const q = query.trim();
	let score = 0;
	if (q.length > 600) score += 2;
	else if (q.length > 220) score += 1;
	if (COMPLEXITY_TERMS.test(q)) score += 2;
	if (MULTISTEP_TERMS.test(q)) score += 1;
	if (/```|\b(sql|python|typescript|javascript|powershell|docker|kubernetes|terraform)\b/i.test(q)) score += 1;
	if (retrievalMode === "agentic") score += 2;

	if (score >= 5) {
		return {
			tier: "deep",
			maxCompletionTokens: 5200,
			verifierMaxCompletionTokens: 5200,
			instruction: "Allocate a deep verification budget: check constraints, arithmetic, evidence and counterexamples internally, but publish only the concise reasoning necessary to justify the answer.",
		};
	}
	if (score >= 2) {
		return {
			tier: "balanced",
			maxCompletionTokens: 3200,
			verifierMaxCompletionTokens: 3800,
			instruction: "Use a balanced reasoning budget and verify important assumptions internally. Do not expose private chain-of-thought.",
		};
	}
	return {
		tier: "default",
		maxCompletionTokens: 1800,
		verifierMaxCompletionTokens: 2600,
		instruction: "Keep compute proportional to the simple request and answer directly. Do not expose private chain-of-thought.",
	};
}

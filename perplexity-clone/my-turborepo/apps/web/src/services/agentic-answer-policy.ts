export type AgenticRetrievalMode = "reasoning" | "focused" | "agentic";
export type AgenticDomain = "general" | "business" | "legal-tax" | "medical" | "finance" | "security" | "technical" | "product";

export interface AgenticSearchSpec {
	readonly query: string;
	readonly includeDomains?: readonly string[];
	readonly numResults?: number;
}

export interface AgenticAnswerPlan {
	readonly retrievalMode: AgenticRetrievalMode;
	readonly domain: AgenticDomain;
	readonly supplementarySearches: readonly AgenticSearchSpec[];
	readonly preferAuthoritative: boolean;
	readonly minimumAuthoritativeSources: number;
	readonly advisorInstruction: string;
}

const CURRENT_RE = /\b(latest|current|today|now|recent|news|price|prices|availability|available|release|released|version|update|updated|202[5-9]|market|trend|forecast|outlook|schedule|law|rule|regulation|policy)\b/i;
const DECISION_RE = /\b(should i|what should i|what would you|recommend|recommendation|best|better|choose|which one|worth it|good idea|bad idea|pros and cons|trade-?off|strategy|plan|how should|what is the best way)\b/i;
const PROBLEM_SOLVING_RE = /\b(fix|solve|solution|why is|why does|how do i|how can i|not working|error|issue|problem|stuck|optimi[sz]e|improve|reduce|increase|grow|build|launch|debug|diagnose)\b/i;
const HIGH_STAKES_RE = /\b(medical|medicine|medication|health|doctor|legal|lawyer|tax|finance|financial|investment|invest|loan|insurance|security|cybersecurity|safety|contract|compliance)\b/i;
const ARGUMENT_RE = /\b(argue|argument|counterargument|debate|case for|case against|why not|downsides?|risks?|limitations?|critique|challenge)\b/i;
const PURE_GENERATION_RE = /\b(write|rewrite|draft|rephrase|translate|translation|poem|story|caption|email|letter|tagline|bio)\b/i;
const EXPLICIT_RESEARCH_RE = /\b(search|research|sources?|evidence|verify|fact-?check|look up|find out)\b/i;
const BUSINESS_RE = /\b(business|startup|saas|market|customer|revenue|mrr|arr|pricing|go-to-market|gtm|sales|distribution|founder|venture|company|product idea|unit economics)\b/i;
const LEGAL_TAX_RE = /\b(gst|tax|taxation|legal|law|compliance|contract|mca|company registration|dpdp|privacy law|sebi|rbi|cbic|income tax|trademark|copyright)\b/i;
const MEDICAL_RE = /\b(health|medical|medicine|medication|drug|treatment|disease|clinical|patient|doctor|symptom|side effect|dosage|dose)\b/i;
const FINANCE_RE = /\b(investment|invest|stock|share|mutual fund|etf|loan|interest rate|insurance|bank|finance|financial|securities|portfolio|returns?)\b/i;
const SECURITY_RE = /\b(security|cybersecurity|malware|phishing|vulnerability|exploit|breach|ransomware|zero-day|cve)\b/i;
const TECH_RE = /\b(code|coding|software|api|sdk|framework|library|database|server|deployment|vercel|github|supabase|docker|windows|linux|driver|gpu|cpu|bug|error)\b/i;
const PRODUCT_RE = /\b(buy|purchase|phone|laptop|monitor|gpu|cpu|camera|headphone|television|tv|product|specification|specs|model)\b/i;
const INDIA_RE = /\b(india|indian|₹|rs\.?|rupees?|gst|mca|dpdp|cbic|sebi|rbi|udyam|msme|startup india)\b/i;

const INDIA_LEGAL_PRIMARY = [
	"cbic-gst.gov.in",
	"gst.gov.in",
	"incometax.gov.in",
	"mca.gov.in",
	"meity.gov.in",
	"indiacode.nic.in",
	"egazette.nic.in",
	"sebi.gov.in",
	"rbi.org.in",
	"msme.gov.in",
	"startupindia.gov.in",
	"dgft.gov.in",
] as const;

const INDIA_BUSINESS_PRIMARY = [
	"indiaai.gov.in",
	"meity.gov.in",
	"pib.gov.in",
	"startupindia.gov.in",
	"msme.gov.in",
	"dashboard.msme.gov.in",
	"udyamregistration.gov.in",
	"data.gov.in",
	"niti.gov.in",
	"dpiit.gov.in",
	"mca.gov.in",
	"cbic-gst.gov.in",
	"gst.gov.in",
	"rbi.org.in",
	"sebi.gov.in",
] as const;

const INDIA_MSME_PRIMARY = [
	"dashboard.msme.gov.in",
	"msme.gov.in",
	"udyamregistration.gov.in",
	"pib.gov.in",
	"data.gov.in",
] as const;

const INDIA_AI_PRIMARY = [
	"pib.gov.in",
	"indiaai.gov.in",
	"meity.gov.in",
] as const;

const MEDICAL_PRIMARY = [
	"mohfw.gov.in",
	"icmr.gov.in",
	"who.int",
	"fda.gov",
	"nih.gov",
	"pubmed.ncbi.nlm.nih.gov",
	"pmc.ncbi.nlm.nih.gov",
	"clinicaltrials.gov",
] as const;

const INDIA_FINANCE_PRIMARY = [
	"rbi.org.in",
	"sebi.gov.in",
	"nseindia.com",
	"bseindia.com",
	"incometax.gov.in",
] as const;

function classifyDomain(query: string): AgenticDomain {
	if (MEDICAL_RE.test(query)) return "medical";
	if (LEGAL_TAX_RE.test(query)) return "legal-tax";
	if (FINANCE_RE.test(query)) return "finance";
	if (SECURITY_RE.test(query)) return "security";
	if (TECH_RE.test(query)) return "technical";
	if (PRODUCT_RE.test(query)) return "product";
	if (BUSINESS_RE.test(query)) return "business";
	return "general";
}

function uniqueSearches(searches: readonly AgenticSearchSpec[], original: string): AgenticSearchSpec[] {
	const seen = new Set<string>([original.trim().toLowerCase()]);
	const out: AgenticSearchSpec[] = [];
	for (const candidate of searches) {
		const query = candidate.query.trim().replace(/\s+/g, " ");
		if (query.length < 3) continue;
		const domainKey = candidate.includeDomains?.join(",").toLowerCase() ?? "";
		const key = `${query.toLowerCase()}|${domainKey}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ ...candidate, query });
	}
	return out.slice(0, 8);
}

function primarySourceSearch(query: string, domain: AgenticDomain): AgenticSearchSpec | null {
	const year = new Date().getUTCFullYear();
	if (domain === "medical") {
		return {
			query: `${query} official guideline primary evidence ${year}`,
			includeDomains: MEDICAL_PRIMARY,
			numResults: 8,
		};
	}
	if (domain === "legal-tax" && INDIA_RE.test(query)) {
		return {
			query: `${query} official rule notification circular ${year}`,
			includeDomains: INDIA_LEGAL_PRIMARY,
			numResults: 8,
		};
	}
	if (domain === "finance" && INDIA_RE.test(query)) {
		return {
			query: `${query} official regulation filing data ${year}`,
			includeDomains: INDIA_FINANCE_PRIMARY,
			numResults: 8,
		};
	}
	if (domain === "business" && INDIA_RE.test(query)) {
		return {
			query: `${query} official India AI startup MSME adoption evidence ${year}`,
			includeDomains: INDIA_BUSINESS_PRIMARY,
			numResults: 10,
		};
	}
	return {
		query: `${query} official primary source authoritative evidence ${year}`,
		numResults: 6,
	};
}

function buildSupplementarySearches(query: string, domain: AgenticDomain): AgenticSearchSpec[] {
	const searches: AgenticSearchSpec[] = [];
	const primary = primarySourceSearch(query, domain);
	const year = new Date().getUTCFullYear();
	if (primary) searches.push(primary);

	if (domain === "business") {
		if (INDIA_RE.test(query)) {
			searches.push({
				query: `India MSME service businesses registrations digital adoption official dashboard ${year}`,
				includeDomains: INDIA_MSME_PRIMARY,
				numResults: 8,
			});
			searches.push({
				query: `IndiaAI Mission startups compute MSME AI adoption official ${year}`,
				includeDomains: INDIA_AI_PRIMARY,
				numResults: 8,
			});
		}
		searches.push({
			query: `${query} customer demand competitors alternatives pricing distribution unit economics`,
			numResults: 6,
		});
		if (INDIA_RE.test(query)) {
			searches.push({
				query: `${query} official India business compliance DPDP GST company requirements ${year}`,
				includeDomains: INDIA_BUSINESS_PRIMARY,
				numResults: 8,
			});
		}
	}
	if (DECISION_RE.test(query) || ARGUMENT_RE.test(query) || domain === "business") {
		searches.push({
			query: `${query} strongest counterargument failure modes risks alternatives`,
			numResults: 6,
		});
	}
	if (PROBLEM_SOLVING_RE.test(query) || DECISION_RE.test(query)) {
		searches.push({
			query: `${query} practical implementation solution verification best practice`,
			numResults: 6,
		});
	}
	if (CURRENT_RE.test(query)) {
		searches.push({ query: `${query} latest update ${year}`, numResults: 6 });
	}
	return uniqueSearches(searches, query);
}

function buildAdvisorInstruction(domain: AgenticDomain): string {
	const decisionInstructions = `
When the user asks for a decision, strategy, business idea, purchase, or plan:
- Consider at least three materially different viable options before choosing.
- For a substantial business/strategy decision, visibly compare at least three options in a compact table or compact scored comparison before the final recommendation, unless the user explicitly asks for a very short answer.
- Compare the options on the factors that actually drive the decision (for example: pain, demand, cost, time-to-value, distribution, risk, reversibility, and fit with the user's existing assets).
- Run an adversarial check against the leading option. Identify the strongest reason it could fail. If the user explicitly asks you to argue against your recommendation, include a distinct strongest-case-against section and a separate condition/evidence threshold that would make you switch recommendations.
- If the user explicitly asks what to avoid, state the most important avoid-list rather than leaving it implicit.
- Make the final recommendation explicit and explain why it beats the alternatives for this user, not just in the abstract.`;

	const evidenceInstructions = `
Evidence discipline:
- Primary and authoritative sources outrank blogs, aggregators, SEO pages, and repeated secondary claims.
- For legal, tax, regulatory, medical, financial, security, and safety claims, do not make a definitive current-rule statement unless supported by a suitable primary/official or strong peer-reviewed source when one should exist. If it is missing, say the point is not verified.
- If your recommendation introduces a regulated topic that the user did not explicitly ask about (for example GST, company registration, DPDP, licensing, tax, or financial regulation), do not state specific thresholds, deadlines, costs, or legal requirements unless the retrieved evidence includes a suitable official source. Otherwise make the point conditional and tell the user it needs current official verification.
- Treat precise forecasts, prices, valuations, MRR/ARR targets, conversion rates, CAC, churn, timelines, percentages, token prices, and market-size numbers from blogs or unknown-quality sources as estimates unless independently corroborated.
- Separate verified facts from estimates, assumptions, inference, and professional judgment. Do not make an estimate sound like a measured fact.
- Corroborate decision-critical numerical claims when practical. One weak source is not enough merely because it contains a precise number.
- Recompute derived arithmetic before presenting it. Never convert a TAM figure into expected company revenue, valuation, or outcome without explicit bottom-up assumptions and correct arithmetic.
- Never claim that a foreign-currency cost range fits a rupee budget unless you show a reasonable conversion assumption or the source itself provides the rupee equivalent.
- For a fixed-budget plan, reconcile allocated spend and reserve so the arithmetic equals the stated budget. If exact costs are too uncertain, use ranges instead of false precision.
- Avoid words such as "guarantees", "forces payment", "routinely", "always", or "will" unless the evidence genuinely supports that strength of claim.
- Do not infer that a source is authoritative just because it ranks highly in search results.`;

	const memoryInstructions = `
Context discipline:
- Treat relevant durable memory and conversation history as the user's current operating state unless the current message corrects it.
- Before recommending setup work, registration, purchases, integrations, or infrastructure, check whether context says the user already has it. Build from existing assets instead of recommending duplicate work.
- When durable memory names an existing company, product, or platform that is directly relevant to the decision, the recommendation must explicitly explain whether to build on that asset, reposition it, or deliberately avoid using it and why. Do not silently ignore relevant named assets.
- If entity/setup status is unknown, do not assume the user is starting from zero. Phrase setup steps conditionally (for example, "if not already incorporated") rather than as mandatory first actions.
- Use memory to improve fit, not to force personalization where it is irrelevant.`;

	const domainSpecific =
		domain === "business"
			? `\nFor business strategy, prioritize evidence of painful demand, willingness to pay, reachable distribution, competitive substitutes, gross-margin economics, implementation cost, time to first revenue, and founder fit. Distinguish evidence from founder assumptions. Do not choose an idea merely because "vertical AI" or "micro-SaaS" is fashionable. Prefer a smaller, testable wedge with a credible route to first revenue over a large TAM story with weak distribution evidence. Do not use top-down market-size capture percentages as the primary revenue case; prefer bottom-up customer-count × price × retention assumptions.`
			: domain === "legal-tax"
				? `\nFor legal/tax/compliance questions, distinguish statutory rules, notifications/circulars, thresholds, exceptions, effective dates, and jurisdiction. Avoid turning a general threshold into a universal rule.`
				: domain === "medical"
					? `\nFor medical questions, distinguish regulatory approval, guidelines, randomized evidence, observational evidence, and anecdote. Do not diagnose or prescribe.`
					: domain === "technical"
						? `\nFor technical questions, prefer official documentation, release notes, source repositories, standards, and reproducible verification over generic tutorials when the exact behavior matters.`
						: domain === "product"
							? `\nFor product decisions, verify current model specifications and support status from manufacturer/official material when possible; use reviews for experience and tradeoffs, not as the source of hard specifications.`
							: "";

	return `## AIRA agentic advisor behavior
Use the web as evidence, not as the product. Solve the user's actual problem like an excellent senior human advisor with real-time research capability.
- Lead with the answer, recommendation, diagnosis, or decision. Do not narrate the search process.
- Synthesize across evidence instead of summarizing sources one by one.
- Be decisive where justified and explicit about what would change the recommendation.
- For troubleshooting: likely cause -> best fix -> verification.
- For strategy/planning: what to do -> what to avoid -> what to watch next.
- Ask a clarifying question only when proceeding would likely produce the wrong answer; otherwise make a reasonable assumption and continue.
- Do not overwhelm the user with every caveat or a giant checklist. Keep only decision-relevant detail.
- End with no more than two concrete next actions when useful. Avoid generic "let me know" endings.
${decisionInstructions}
${evidenceInstructions}
${memoryInstructions}${domainSpecific}`;
}

export function buildAgenticAnswerPlan(query: string): AgenticAnswerPlan {
	const q = query.trim();
	const domain = classifyDomain(q);
	const wordCount = q.split(/\s+/).filter(Boolean).length;
	const pureGeneration = PURE_GENERATION_RE.test(q) && !EXPLICIT_RESEARCH_RE.test(q) && !CURRENT_RE.test(q);

	if (pureGeneration) {
		return {
			retrievalMode: "reasoning",
			domain,
			supplementarySearches: [],
			preferAuthoritative: false,
			minimumAuthoritativeSources: 0,
			advisorInstruction: buildAdvisorInstruction(domain),
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
	const highStakes = domain === "legal-tax" || domain === "medical" || domain === "finance" || domain === "security";
	const indiaBusinessDecision = domain === "business" && INDIA_RE.test(q) && substantive;

	return {
		retrievalMode: substantive ? "agentic" : "focused",
		domain,
		supplementarySearches: substantive ? buildSupplementarySearches(q, domain) : [],
		preferAuthoritative: substantive || highStakes,
		minimumAuthoritativeSources: highStakes || indiaBusinessDecision ? 2 : substantive ? 1 : 0,
		advisorInstruction: buildAdvisorInstruction(domain),
	};
}

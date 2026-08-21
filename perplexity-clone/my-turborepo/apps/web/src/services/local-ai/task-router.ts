export type ComputeTier = "local" | "cloud";

export type LocalTaskKind =
	| "chat"
	| "summarize"
	| "rewrite"
	| "extract"
	| "classify"
	| "lead"
	| "email"
	| "rag"
	| "code"
	| "research"
	| "unknown";

export interface RoutingDecision {
	readonly tier: ComputeTier;
	readonly taskKind: LocalTaskKind;
	readonly score: number;
	readonly reason: string;
	readonly signals: readonly string[];
}

const CLOUD_PATTERNS: readonly [RegExp, string, number][] = [
	[/\b(latest|today|current|news|recent|live|right now)\b/i, "fresh-information", -5],
	[/\b(search the web|browse|sources?|citations?|verify online|research online)\b/i, "web-research", -6],
	[/\b(law|legal|tax|taxation|compliance|regulation|court|contract)\b/i, "high-stakes-legal", -5],
	[/\b(medical|medicine|diagnos|dose|drug|treatment|symptom)\b/i, "high-stakes-medical", -5],
	[/\b(financial model|valuation|investment decision|securities|portfolio allocation)\b/i, "high-stakes-finance", -4],
	[/\b(system architecture|production architecture|threat model|security audit|incident response)\b/i, "complex-architecture", -4],
	[/\b(refactor (?:the )?entire|large codebase|multi-file|production-ready implementation)\b/i, "large-coding-task", -4],
];

const LOCAL_PATTERNS: readonly [RegExp, string, number, LocalTaskKind][] = [
	[/\b(classify|categorize|label|triage)\b/i, "classification", 4, "classify"],
	[/\b(extract|parse|return json|structured json|fields?)\b/i, "structured-extraction", 4, "extract"],
	[/\b(summarize|summary|tl;dr)\b/i, "summarization", 3, "summarize"],
	[/\b(rewrite|rephrase|polish|shorten|format)\b/i, "rewriting", 3, "rewrite"],
	[/\b(lead|prospect|crm|qualification|lead score)\b/i, "lead-ops", 4, "lead"],
	[/\b(email|inbox|reply needed|mail triage)\b/i, "email-ops", 4, "email"],
	[/\b(knowledge base|local document|internal document|company knowledge|rag)\b/i, "private-rag", 3, "rag"],
	[/\b(simple code|small script|regex|sql query|one function)\b/i, "small-coding-task", 2, "code"],
];

const EXPLICIT_LOCAL_KINDS = new Set<LocalTaskKind>([
	"summarize",
	"rewrite",
	"extract",
	"classify",
	"lead",
	"email",
	"rag",
	"code",
]);

function inferKind(prompt: string, explicit?: LocalTaskKind): { kind: LocalTaskKind; signals: string[]; score: number } {
	if (explicit && explicit !== "unknown") {
		return {
			kind: explicit,
			signals: [`task:${explicit}`],
			score: EXPLICIT_LOCAL_KINDS.has(explicit) ? 2 : 0,
		};
	}
	let kind: LocalTaskKind = "chat";
	let score = 0;
	const signals: string[] = [];
	for (const [pattern, signal, weight, candidate] of LOCAL_PATTERNS) {
		if (!pattern.test(prompt)) continue;
		score += weight;
		signals.push(signal);
		if (kind === "chat") kind = candidate;
	}
	return { kind, signals, score };
}

export function routeLocalAiTask(args: {
	readonly prompt: string;
	readonly taskKind?: LocalTaskKind;
	readonly localFirst?: boolean;
}): RoutingDecision {
	const prompt = args.prompt.trim();
	const inferred = inferKind(prompt, args.taskKind);
	let score = inferred.score + (args.localFirst ? 1 : 0);
	const signals = [...inferred.signals];

	if (prompt.length <= 3000) {
		score += 1;
		signals.push("short-context");
	} else if (prompt.length > 9000) {
		score -= 4;
		signals.push("long-context");
	}

	for (const [pattern, signal, weight] of CLOUD_PATTERNS) {
		if (!pattern.test(prompt)) continue;
		score += weight;
		signals.push(signal);
	}

	if (inferred.kind === "research") {
		score -= 5;
		signals.push("research-task");
	}

	const tier: ComputeTier = score >= 2 ? "local" : "cloud";
	return {
		tier,
		taskKind: inferred.kind,
		score,
		reason:
			tier === "local"
				? "Routine/private task is suitable for the local worker model."
				: "Task needs fresher information, higher-stakes reasoning, or more compute than the local worker should own.",
		signals,
	};
}

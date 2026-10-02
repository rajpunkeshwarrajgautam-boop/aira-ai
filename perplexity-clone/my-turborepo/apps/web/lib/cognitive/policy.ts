export interface CognitiveRouteDecision {
	readonly advancedReasoning: boolean;
	readonly memoryRecall: boolean;
	readonly memoryWrite: boolean;
	readonly memoryDisabled: boolean;
	readonly reasonCodes: readonly string[];
}

function includesAny(text: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

export function routeCognitiveCapabilities(message: string): CognitiveRouteDecision {
	const text = message.trim().replace(/\s+/g, " ").toLowerCase();
	const reasonCodes: string[] = [];

	const memoryDisabled = includesAny(text, [
		/\b(?:do not|don't|dont)\s+(?:remember|store|save|use memory)\b/,
		/\b(?:private session|private mode|no memory|without memory|memory off)\b/,
	]);
	if (memoryDisabled) reasonCodes.push("MEMORY_DISABLED_BY_USER");

	const memoryWrite = !memoryDisabled && includesAny(text, [
		/\bremember\s+(?:that|this)\b/,
		/\b(?:from now on|going forward|always|default to)\b/,
		/\bmy preference is\b/,
		/\b(?:this|our) project must\b/,
		/\bwe (?:decided|agreed) to\b/,
		/\b(?:save|store) (?:this|that) (?:preference|decision|constraint|rule|context)\b/,
	]);
	if (memoryWrite) reasonCodes.push("DURABLE_MEMORY_WRITE_SIGNAL");

	const memoryRecall = !memoryDisabled && includesAny(text, [
		/\b(?:remember|recall)\b.*\b(?:previous|earlier|last|before|decision|preference|context)\b/,
		/\b(?:continue|resume|pick up)\b.*\b(?:plan|work|task|migration|project|where we left off)\b/,
		/\b(?:we decided|we agreed|last time|earlier we|previously|as before|same as before)\b/,
		/\b(?:our|this) project\b.*\b(?:convention|constraint|decision|history|preference|stack)\b/,
		/\bmy (?:preference|usual|default|previous)\b/,
	]);
	if (memoryRecall) reasonCodes.push("PRIOR_CONTEXT_REQUIRED");

	const advancedReasoning = includesAny(text, [
		/\b(?:deep reasoning|reason deeply|think deeply|advanced reasoning)\b/,
		/\b(?:compare|evaluate|assess)\b.*\b(?:architecture|architectures|trade-?offs?|approaches|strategies|options)\b/,
		/\b(?:hypothesis|hypotheses|root cause|bottleneck|failure mode|debug|diagnose)\b/,
		/\b(?:challenge|test)\b.*\b(?:assumptions?|hypotheses|premise|reasoning)\b/,
		/\b(?:verify|validate)\b.*\b(?:architecture|design|plan|reasoning|assumptions?)\b/,
		/\b(?:complex|multi-step|multi step)\b.*\b(?:analysis|decision|plan|problem)\b/,
		/\b(?:design|architect)\b.*\b(?:system|platform|infrastructure|workflow|agent)\b/,
	]);
	if (advancedReasoning) reasonCodes.push("ADVANCED_REASONING_SIGNAL");

	return {
		advancedReasoning,
		memoryRecall,
		memoryWrite,
		memoryDisabled,
		reasonCodes,
	};
}

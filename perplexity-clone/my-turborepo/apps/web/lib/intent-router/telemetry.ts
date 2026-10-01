import type { IntentDecision } from "./contract";

export interface IntentDecisionTelemetry {
	readonly event: "[AiraIntentRouter] decision";
	readonly intent: IntentDecision["intent"];
	readonly confidence: number;
	readonly complexity: IntentDecision["complexity"];
	readonly risk: IntentDecision["risk"];
	readonly sideEffect: IntentDecision["sideEffect"];
	readonly requiredCapabilities: readonly string[];
	readonly executionSurface: IntentDecision["executionSurface"];
	readonly requiresApproval: boolean;
	readonly recurrenceType?: NonNullable<IntentDecision["recurrence"]>["type"];
	readonly fallbackReason?: string;
}

export function toIntentDecisionTelemetry(decision: IntentDecision): IntentDecisionTelemetry {
	return {
		event: "[AiraIntentRouter] decision",
		intent: decision.intent,
		confidence: decision.confidence,
		complexity: decision.complexity,
		risk: decision.risk,
		sideEffect: decision.sideEffect,
		requiredCapabilities: [...decision.requiredCapabilities],
		executionSurface: decision.executionSurface,
		requiresApproval: decision.requiresApproval,
		...(decision.recurrence ? { recurrenceType: decision.recurrence.type } : {}),
		...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
	};
}

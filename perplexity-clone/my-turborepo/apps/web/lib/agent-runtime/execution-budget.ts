import type {
	ActionLoopGuardResult,
	ActionLoopGuardState,
	BudgetViolation,
	ExecutionBudget,
	ExecutionUsage,
} from "./types";

function assertFinite(name: string, value: number): void {
	if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function assertIntegerAtLeast(name: string, value: number, minimum: number): void {
	assertFinite(name, value);
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`${name} must be an integer >= ${minimum}.`);
	}
}

export function validateExecutionBudget(budget: ExecutionBudget): void {
	assertIntegerAtLeast("maxConcurrentAgents", budget.maxConcurrentAgents, 1);
	assertIntegerAtLeast("maxDelegationDepth", budget.maxDelegationDepth, 0);
	assertIntegerAtLeast("maxRetriesPerTask", budget.maxRetriesPerTask, 0);
	assertIntegerAtLeast("maxToolCalls", budget.maxToolCalls, 0);
	assertIntegerAtLeast("maxTokens", budget.maxTokens, 0);
	assertIntegerAtLeast("maxRuntimeMs", budget.maxRuntimeMs, 1);
	assertIntegerAtLeast("maxRepeatedActions", budget.maxRepeatedActions, 1);
	assertFinite("maxEstimatedCostUsd", budget.maxEstimatedCostUsd);
	if (budget.maxEstimatedCostUsd < 0) {
		throw new Error("maxEstimatedCostUsd must be >= 0.");
	}
}

export function collectGlobalBudgetViolations(
	budget: ExecutionBudget,
	usage: ExecutionUsage,
	nowMs: number,
): readonly BudgetViolation[] {
	validateExecutionBudget(budget);
	const violations: BudgetViolation[] = [];
	const elapsedMs = Math.max(0, nowMs - usage.startedAtMs);

	if (elapsedMs >= budget.maxRuntimeMs) {
		violations.push({
			limit: "runtime",
			message: "The run reached its maximum execution time.",
			current: elapsedMs,
			maximum: budget.maxRuntimeMs,
		});
	}
	if (usage.toolCalls >= budget.maxToolCalls) {
		violations.push({
			limit: "tool_calls",
			message: "The run reached its tool-call budget.",
			current: usage.toolCalls,
			maximum: budget.maxToolCalls,
		});
	}
	if (usage.tokens >= budget.maxTokens) {
		violations.push({
			limit: "tokens",
			message: "The run reached its token budget.",
			current: usage.tokens,
			maximum: budget.maxTokens,
		});
	}
	if (usage.estimatedCostUsd >= budget.maxEstimatedCostUsd) {
		violations.push({
			limit: "estimated_cost",
			message: "The run reached its estimated monetary budget.",
			current: usage.estimatedCostUsd,
			maximum: budget.maxEstimatedCostUsd,
		});
	}

	return violations;
}

export function createActionLoopGuardState(maxRepeatedActions: number): ActionLoopGuardState {
	assertIntegerAtLeast("maxRepeatedActions", maxRepeatedActions, 1);
	return { maxRepeatedActions, counts: {} };
}

export function registerActionFingerprint(
	state: ActionLoopGuardState,
	fingerprint: string,
): ActionLoopGuardResult {
	const normalized = fingerprint.trim().slice(0, 512);
	if (!normalized) throw new Error("Action fingerprint must be non-empty.");

	const count = (state.counts[normalized] ?? 0) + 1;
	return {
		state: {
			maxRepeatedActions: state.maxRepeatedActions,
			counts: { ...state.counts, [normalized]: count },
		},
		blocked: count > state.maxRepeatedActions,
		count,
	};
}

import {
	collectGlobalBudgetViolations,
	createActionLoopGuardState,
	registerActionFingerprint,
} from "./execution-budget";
import type {
	ActionLoopGuardState,
	BudgetViolation,
	ExecutionBudget,
	ExecutionUsage,
} from "./types";

export class AgentRuntimeBudgetError extends Error {
	readonly code = "AGENT_RUNTIME_BUDGET_EXCEEDED";
	readonly violations: readonly BudgetViolation[];

	constructor(violations: readonly BudgetViolation[]) {
		super(violations.map((violation) => violation.message).join(" "));
		this.name = "AgentRuntimeBudgetError";
		this.violations = violations;
	}
}

export class AgentRuntimeLoopError extends Error {
	readonly code = "AGENT_RUNTIME_REPEATED_ACTION";
	readonly fingerprint: string;
	readonly count: number;

	constructor(fingerprint: string, count: number) {
		super(`Repeated action blocked after ${count} identical attempts.`);
		this.name = "AgentRuntimeLoopError";
		this.fingerprint = fingerprint;
		this.count = count;
	}
}

export class ExecutionMeter {
	readonly budget: ExecutionBudget;
	private usage: ExecutionUsage;
	private loopGuard: ActionLoopGuardState;

	constructor(budget: ExecutionBudget, startedAtMs = Date.now()) {
		this.budget = budget;
		this.usage = {
			startedAtMs,
			activeAgents: 0,
			toolCalls: 0,
			tokens: 0,
			estimatedCostUsd: 0,
		};
		this.loopGuard = createActionLoopGuardState(budget.maxRepeatedActions);
	}

	snapshot(): ExecutionUsage {
		return { ...this.usage };
	}

	assertCanContinue(nowMs = Date.now()): void {
		const violations = collectGlobalBudgetViolations(this.budget, this.usage, nowMs);
		if (violations.length > 0) throw new AgentRuntimeBudgetError(violations);
	}

	setActiveAgents(activeAgents: number): void {
		if (!Number.isInteger(activeAgents) || activeAgents < 0) {
			throw new Error("activeAgents must be a non-negative integer.");
		}
		this.usage = { ...this.usage, activeAgents };
	}

	beforeToolCall(fingerprint: string, nowMs = Date.now()): void {
		this.assertCanContinue(nowMs);
		const result = registerActionFingerprint(this.loopGuard, fingerprint);
		this.loopGuard = result.state;
		if (result.blocked) throw new AgentRuntimeLoopError(fingerprint, result.count);
		this.usage = { ...this.usage, toolCalls: this.usage.toolCalls + 1 };
	}

	recordModelUsage(tokens: number, estimatedCostUsd = 0): void {
		if (!Number.isFinite(tokens) || tokens < 0) {
			throw new Error("tokens must be a non-negative finite number.");
		}
		if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
			throw new Error("estimatedCostUsd must be a non-negative finite number.");
		}
		this.usage = {
			...this.usage,
			tokens: this.usage.tokens + Math.trunc(tokens),
			estimatedCostUsd: this.usage.estimatedCostUsd + estimatedCostUsd,
		};
	}
}

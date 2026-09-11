export interface BudgetUsageState {
	readonly runId: string;
	readonly userId: string;
	readonly totalCostUsd: number;
	readonly totalTokens: number;
	readonly toolCallCount: number;
	readonly executionDurationMs: number;
	readonly isExhausted: boolean;
	readonly exhaustionReason?: string;
}

export class CostControlEnforcer {
	private usage = new Map<string, BudgetUsageState>();

	track(runId: string, userId: string, delta: {
		costUsd?: number;
		tokens?: number;
		toolCalls?: number;
		durationMs?: number;
	}, limits: {
		maxCostUsd: number;
		maxTokens: number;
		maxToolCalls: number;
	}): BudgetUsageState {
		const current = this.usage.get(runId) ?? {
			runId,
			userId,
			totalCostUsd: 0,
			totalTokens: 0,
			toolCallCount: 0,
			executionDurationMs: 0,
			isExhausted: false,
		};

		const nextCost = current.totalCostUsd + (delta.costUsd ?? 0);
		const nextTokens = current.totalTokens + (delta.tokens ?? 0);
		const nextCalls = current.toolCallCount + (delta.toolCalls ?? 0);
		const nextDuration = current.executionDurationMs + (delta.durationMs ?? 0);

		let isExhausted = false;
		let reason: string | undefined;

		if (nextCost > limits.maxCostUsd) {
			isExhausted = true;
			reason = `Cost budget exceeded ($${nextCost.toFixed(3)} > $${limits.maxCostUsd})`;
		} else if (nextTokens > limits.maxTokens) {
			isExhausted = true;
			reason = `Token budget exceeded (${nextTokens} > ${limits.maxTokens})`;
		} else if (nextCalls > limits.maxToolCalls) {
			isExhausted = true;
			reason = `Tool call limit exceeded (${nextCalls} > ${limits.maxToolCalls})`;
		}

		const nextState: BudgetUsageState = {
			runId,
			userId,
			totalCostUsd: nextCost,
			totalTokens: nextTokens,
			toolCallCount: nextCalls,
			executionDurationMs: nextDuration,
			isExhausted,
			exhaustionReason: reason,
		};

		this.usage.set(runId, nextState);
		return nextState;
	}

	getState(runId: string): BudgetUsageState | undefined {
		return this.usage.get(runId);
	}
}

export const globalCostControlEnforcer = new CostControlEnforcer();

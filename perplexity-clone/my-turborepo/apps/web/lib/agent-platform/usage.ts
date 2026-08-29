import { prisma } from "@/lib/prisma";
import type { UsageDelta } from "@/lib/tool-gateway/types";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function usageFromRuntimeResult(result: unknown): UsageDelta {
	const root = record(result);
	const usage = record(root.usage);
	const inputTokens = number(usage.inputTokens ?? usage.promptTokens ?? root.inputTokens ?? root.promptTokens);
	const outputTokens = number(usage.outputTokens ?? usage.completionTokens ?? root.outputTokens ?? root.completionTokens);
	const cachedTokens = number(usage.cachedTokens ?? root.cachedTokens);
	const costUsd = number(usage.costUsd ?? usage.totalCostUsd ?? root.costUsd ?? root.totalCostUsd);
	return {
		...(inputTokens !== undefined ? { inputTokens: Math.trunc(inputTokens) } : {}),
		...(outputTokens !== undefined ? { outputTokens: Math.trunc(outputTokens) } : {}),
		...(cachedTokens !== undefined ? { cachedTokens: Math.trunc(cachedTokens) } : {}),
		...(costUsd !== undefined ? { costUsd, costKnown: true } : { costKnown: false }),
	};
}

export async function applyRuntimeUsage(runId: string, usage: UsageDelta): Promise<void> {
	const input = Math.max(0, Math.trunc(usage.inputTokens ?? 0));
	const output = Math.max(0, Math.trunc(usage.outputTokens ?? 0));
	const cached = Math.max(0, Math.trunc(usage.cachedTokens ?? 0));
	const cost = Math.max(0, usage.costUsd ?? 0);
	await prisma.$executeRaw`
		update "AgentPlatformRun"
		set "inputTokensUsed"="inputTokensUsed"+${input}::bigint,
			"outputTokensUsed"="outputTokensUsed"+${output}::bigint,
			"cachedTokensUsed"="cachedTokensUsed"+${cached}::bigint,
			"knownCostUsd"="knownCostUsd"+${cost}::numeric,
			"updatedAt"=current_timestamp
		where "id"=${runId}
	`;
}

export function missionBudgetExceeded(input: {
	readonly budgets: { maxTokens: number; maxCostUsd: number; maxToolCalls: number };
	readonly usage: {
		toolCallsUsed: number;
		inputTokensUsed: bigint;
		outputTokensUsed: bigint;
		knownCostUsd: string;
	};
}): { readonly exceeded: false } | { readonly exceeded: true; readonly reason: string } {
	const tokens = input.usage.inputTokensUsed + input.usage.outputTokensUsed;
	if (tokens >= BigInt(input.budgets.maxTokens)) {
		return { exceeded: true, reason: `Mission reached its ${input.budgets.maxTokens}-token budget.` };
	}
	if (input.usage.toolCallsUsed >= input.budgets.maxToolCalls) {
		return { exceeded: true, reason: `Mission reached its ${input.budgets.maxToolCalls}-tool-call budget.` };
	}
	const knownCost = Number(input.usage.knownCostUsd);
	if (input.budgets.maxCostUsd > 0 && Number.isFinite(knownCost) && knownCost >= input.budgets.maxCostUsd) {
		return { exceeded: true, reason: `Mission reached its $${input.budgets.maxCostUsd.toFixed(2)} known-cost budget.` };
	}
	return { exceeded: false };
}

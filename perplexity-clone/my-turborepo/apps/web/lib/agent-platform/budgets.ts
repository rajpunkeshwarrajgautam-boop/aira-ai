import { BillingPlan } from "@/generated/prisma/enums";
import {
	getEffectiveEntitlements,
	type EffectiveEntitlements,
	PlanEnforcementError,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";

import type { RunBudgets } from "./types";

export interface PlanCeilings extends RunBudgets {
	readonly maxActiveRuns: number;
}

export function resolvePlanBudgetCeilings(plan: BillingPlan): PlanCeilings {
	switch (plan) {
		case BillingPlan.TEAM:
			return {
				maxAgents: 24,
				maxParallelAgents: 6,
				maxToolCalls: 200,
				maxTokens: 2_000_000,
				maxCostUsd: 100,
				maxDurationMinutes: 360,
				maxRetries: 3,
				maxActiveRuns: 10,
			};
		case BillingPlan.PRO:
			return {
				maxAgents: 12,
				maxParallelAgents: 4,
				maxToolCalls: 100,
				maxTokens: 1_000_000,
				maxCostUsd: 25,
				maxDurationMinutes: 120,
				maxRetries: 2,
				maxActiveRuns: 5,
			};
		case BillingPlan.FREE:
		default:
			return {
				maxAgents: 6,
				maxParallelAgents: 2,
				maxToolCalls: 30,
				maxTokens: 250_000,
				maxCostUsd: 5,
				maxDurationMinutes: 30,
				maxRetries: 1,
				maxActiveRuns: 3,
			};
	}
}

export async function resolveEffectiveWorkBudgets(
	userId: string,
	requested?: Partial<RunBudgets>,
): Promise<{ effectiveBudgets: RunBudgets; entitlements: EffectiveEntitlements }> {
	const entitlements = await getEffectiveEntitlements(userId);
	const ceilings = resolvePlanBudgetCeilings(entitlements.billingPlan);

	// Check active runs ceiling
	const activeRuns = await prisma.$queryRaw<Array<{ count: bigint }>>`
		select count(*)::bigint as count
		from "AgentPlatformRun"
		where "userId"=${userId}
		  and "status" in ('PLANNING','RUNNING','WAITING','APPROVAL_REQUIRED')
	`.catch(() => [{ count: 0n }]);

	const currentActiveCount = Number(activeRuns[0]?.count ?? 0);
	if (currentActiveCount >= ceilings.maxActiveRuns) {
		throw new PlanEnforcementError(
			429,
			"WORK_RUN_QUOTA_EXCEEDED",
			`Your ${entitlements.billingPlan} tier allows at most ${ceilings.maxActiveRuns} concurrent managed runs. Wait for an active run to complete before launching another.`,
		);
	}

	// Server-side clamping: effective budget is minimum of requested, ceiling, and hard bounds.
	// Client can NEVER escalate beyond their plan ceiling.
	const effectiveBudgets: RunBudgets = {
		maxAgents: Math.max(1, Math.min(requested?.maxAgents ?? ceilings.maxAgents, ceilings.maxAgents)),
		maxParallelAgents: Math.max(1, Math.min(requested?.maxParallelAgents ?? ceilings.maxParallelAgents, ceilings.maxParallelAgents)),
		maxToolCalls: Math.max(5, Math.min(requested?.maxToolCalls ?? ceilings.maxToolCalls, ceilings.maxToolCalls)),
		maxTokens: Math.max(5_000, Math.min(requested?.maxTokens ?? ceilings.maxTokens, ceilings.maxTokens)),
		maxCostUsd: Math.max(0.5, Math.min(requested?.maxCostUsd ?? ceilings.maxCostUsd, ceilings.maxCostUsd)),
		maxDurationMinutes: Math.max(5, Math.min(requested?.maxDurationMinutes ?? ceilings.maxDurationMinutes, ceilings.maxDurationMinutes)),
		maxRetries: Math.max(0, Math.min(requested?.maxRetries ?? ceilings.maxRetries, ceilings.maxRetries)),
	};

	return { effectiveBudgets, entitlements };
}

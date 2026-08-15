import { BillingPlan } from "@/generated/prisma/enums";

export interface PlanLimits {
	readonly searchesPerMonth: number;
	readonly agentRunsPerMonth: number;
	/** Minimum purchased seats for TEAM checkout. */
	readonly minTeamSeats: number;
	readonly maxTeamSeats: number;
}

export const PLAN_LIMITS: Record<BillingPlan, PlanLimits> = {
	[BillingPlan.FREE]: {
		searchesPerMonth: 250,
		agentRunsPerMonth: 0,
		minTeamSeats: 1,
		maxTeamSeats: 1,
	},
	[BillingPlan.PRO]: {
		searchesPerMonth: 2_000,
		agentRunsPerMonth: 50,
		minTeamSeats: 1,
		maxTeamSeats: 1,
	},
	[BillingPlan.TEAM]: {
		searchesPerMonth: 10_000,
		agentRunsPerMonth: 250,
		minTeamSeats: 2,
		maxTeamSeats: 100,
	},
};

export type PaidCheckoutPlan = "pro" | "team";

export function billingPlanFromCheckout(plan: PaidCheckoutPlan): BillingPlan {
	return plan === "pro" ? BillingPlan.PRO : BillingPlan.TEAM;
}

/**
 * Effective monthly search cap. TEAM multiplies base cap by purchased seats.
 */
export function effectiveMonthlySearchLimit(plan: BillingPlan, teamSeats: number): number {
	const base = PLAN_LIMITS[plan].searchesPerMonth;
	if (plan === BillingPlan.TEAM) {
		const seats = Math.max(PLAN_LIMITS.TEAM.minTeamSeats, teamSeats);
		return base * seats;
	}
	return base;
}

/**
 * Effective monthly AutoGPT run cap. TEAM multiplies the base cap by seats.
 */
export function effectiveMonthlyAgentRunLimit(plan: BillingPlan, teamSeats: number): number {
	const base = PLAN_LIMITS[plan].agentRunsPerMonth;
	if (plan === BillingPlan.TEAM) {
		const seats = Math.max(PLAN_LIMITS.TEAM.minTeamSeats, teamSeats);
		return base * seats;
	}
	return base;
}

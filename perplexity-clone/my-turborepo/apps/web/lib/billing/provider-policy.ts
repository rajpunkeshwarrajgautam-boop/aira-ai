import { BillingPlan } from "@/generated/prisma/enums";
import type { ProviderAccessTier } from "@services/providers/provider-selection";

/**
 * Free and anonymous searches must use the configured free provider directly.
 * Paid plans may use the Pro gateway with the free provider as its fallback.
 */
export function providerAccessTierForBillingPlan(
	plan: BillingPlan | null | undefined,
): ProviderAccessTier {
	return plan === BillingPlan.PRO || plan === BillingPlan.TEAM ? "pro" : "free";
}

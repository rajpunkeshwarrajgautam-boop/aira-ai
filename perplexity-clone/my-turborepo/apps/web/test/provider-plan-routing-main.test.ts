import assert from "node:assert/strict";
import test from "node:test";

import { BillingPlan } from "@/generated/prisma/enums";
import { providerAccessTierForBillingPlan } from "@/lib/billing/provider-policy";
import {
	FREE_TIER_PROVIDER_ID,
	resolveProviderRoute,
} from "@services/providers/provider-selection";

test("maps anonymous and Free searches to the free provider tier", () => {
	assert.equal(providerAccessTierForBillingPlan(undefined), "free");
	assert.equal(providerAccessTierForBillingPlan(null), "free");
	assert.equal(providerAccessTierForBillingPlan(BillingPlan.FREE), "free");
});

test("maps paid searches to the Pro provider tier", () => {
	assert.equal(providerAccessTierForBillingPlan(BillingPlan.PRO), "pro");
	assert.equal(providerAccessTierForBillingPlan(BillingPlan.TEAM), "pro");
});

test("hard-pins NVIDIA for free requests even when deployment configuration is stale", () => {
	assert.equal(FREE_TIER_PROVIDER_ID, "nvidia");
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_PROVIDER: "openai",
			DEFAULT_PRO_PROVIDER: "openai",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: "nvidia",
		},
	);
});

test("routes paid requests through the configured Pro provider with NVIDIA fallback", () => {
	assert.deepEqual(
		resolveProviderRoute("pro", {
			DEFAULT_PRO_PROVIDER: "self-hosted",
			DEFAULT_FREE_PROVIDER: "openai",
		}),
		{
			primaryProviderId: "self-hosted",
			fallbackProviderId: "nvidia",
		},
	);
});

test("preserves OpenAI as the main-branch Pro default", () => {
	assert.deepEqual(resolveProviderRoute("pro", {}), {
		primaryProviderId: "openai",
		fallbackProviderId: "nvidia",
	});
});

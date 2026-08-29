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

test("hard-pins NVIDIA for free requests across stale deployment configuration values", () => {
assert.equal(FREE_TIER_PROVIDER_ID, "nvidia");

for (const staleFreeProvider of [
"openai",
"anthropic",
"omniroute",
"unknown-provider",
]) {
assert.deepEqual(
resolveProviderRoute("free", {
DEFAULT_FREE_PROVIDER: staleFreeProvider,
DEFAULT_PRO_PROVIDER: "omniroute",
}),
{
primaryProviderId: "nvidia",
fallbackProviderId: "nvidia",
},
);
}
});

test("routes paid requests through the configured Pro provider with NVIDIA fallback", () => {
assert.deepEqual(
resolveProviderRoute("pro", {
DEFAULT_PRO_PROVIDER: "openai",
DEFAULT_FREE_PROVIDER: "openai",
}),
{
primaryProviderId: "openai",
fallbackProviderId: "nvidia",
},
);
});

test("uses OmniRoute as the Pro default after the OmniRoute rollout", () => {
assert.deepEqual(resolveProviderRoute("pro", {}), {
primaryProviderId: "omniroute",
fallbackProviderId: "nvidia",
});
});
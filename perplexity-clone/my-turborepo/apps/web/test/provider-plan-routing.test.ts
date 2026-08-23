import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BillingPlan } from "../generated/prisma/enums";
import { providerAccessTierForBillingPlan } from "../lib/billing/provider-policy";
import { resolveProviderRoute } from "../src/services/providers/provider-selection";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("maps anonymous and Free searches to the free provider tier", () => {
	assert.equal(providerAccessTierForBillingPlan(undefined), "free");
	assert.equal(providerAccessTierForBillingPlan(null), "free");
	assert.equal(providerAccessTierForBillingPlan(BillingPlan.FREE), "free");
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_PROVIDER: "nvidia",
			DEFAULT_PRO_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: "nvidia",
		},
	);
});

test("keeps NVIDIA as the Free provider when deployment configuration is stale", () => {
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_PROVIDER: "omniroute",
			DEFAULT_PRO_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: "nvidia",
		},
	);
});

test("maps paid searches to the Pro provider with the free provider as fallback", () => {
	for (const plan of [BillingPlan.PRO, BillingPlan.TEAM]) {
		assert.equal(providerAccessTierForBillingPlan(plan), "pro");
	}
	assert.deepEqual(
		resolveProviderRoute("pro", {
			DEFAULT_FREE_PROVIDER: "nvidia",
			DEFAULT_PRO_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "omniroute",
			fallbackProviderId: "nvidia",
		},
	);
});

test("the search route injects its entitlement-selected router into every answer path", () => {
	const route = readFileSync(path.join(WEB_ROOT, "app/api/search/route-core.ts"), "utf8");
	assert.ok(route.includes("providerAccessTierForBillingPlan(entitlements?.billingPlan)"));
	assert.equal(
		route.match(/router:\s*await ProviderRouter\.createDefault\(providerTier\)/g)?.length,
		4,
		"greeting, standard, deep, and agentic-deep answer paths must share the entitlement-selected router",
	);
});

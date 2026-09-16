import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BillingPlan } from "../generated/prisma/enums";
import { providerAccessTierForBillingPlan } from "../lib/billing/provider-policy";
import { resolveProviderRoute, FREE_TIER_FALLBACK_PROVIDER_ID } from "../src/services/providers/provider-selection";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// DEFECT-P2-01 fix: free tier now uses a distinct fallback provider (openai by
// default) so that when NVIDIA (primary) is degraded, the router can perform
// real failover instead of re-attempting the same provider.

test("maps anonymous and Free searches to the free provider tier", () => {
	assert.equal(providerAccessTierForBillingPlan(undefined), "free");
	assert.equal(providerAccessTierForBillingPlan(null), "free");
	assert.equal(providerAccessTierForBillingPlan(BillingPlan.FREE), "free");
	// Free tier primary is always nvidia. Fallback is openai (not nvidia) so
	// that a distinct fallbackCore is instantiated and failover is possible.
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_PROVIDER: "nvidia",
			DEFAULT_PRO_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: FREE_TIER_FALLBACK_PROVIDER_ID,
		},
	);
});

test("keeps NVIDIA as the Free provider primary when deployment configuration is stale, but uses the correct failover target", () => {
	// Even if the environment tries to set a non-free primary, the free tier
	// invariant pins primary to "nvidia". The fallback resolves independently
	// to DEFAULT_FREE_FALLBACK_PROVIDER (openai by default).
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_PROVIDER: "omniroute",
			DEFAULT_PRO_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: FREE_TIER_FALLBACK_PROVIDER_ID,
		},
	);
});

test("respects DEFAULT_FREE_FALLBACK_PROVIDER environment override for the free tier fallback", () => {
	assert.deepEqual(
		resolveProviderRoute("free", {
			DEFAULT_FREE_FALLBACK_PROVIDER: "omniroute",
		}),
		{
			primaryProviderId: "nvidia",
			fallbackProviderId: "omniroute",
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
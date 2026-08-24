import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("persistent memory curation derives provider tier from server-side entitlements", () => {
  const source = read("lib/persistent-memory-core.ts");

  assert.ok(
    source.includes('getEffectiveEntitlements(args.userId)'),
    "memory curation must resolve the authenticated user's effective billing plan server-side",
  );
  assert.ok(
    source.includes('providerAccessTierForBillingPlan(entitlements.billingPlan)'),
    "memory curation must map the effective billing plan to a provider tier",
  );
  assert.ok(
    source.includes('ProviderRouter.createDefault(providerTier)'),
    "memory curation must construct the router with the resolved tier",
  );
});

test("persistent memory curation cannot silently fall back to the Pro default router", () => {
  const source = read("lib/persistent-memory-core.ts");
  assert.ok(
    !source.includes('ProviderRouter.createDefault();'),
    "a bare createDefault() would silently route FREE memory curation through the Pro default",
  );
});

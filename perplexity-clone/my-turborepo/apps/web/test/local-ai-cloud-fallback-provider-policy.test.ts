import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("hybrid local-AI cloud fallback resolves the authenticated user's provider tier", () => {
  const source = read("src/services/local-ai/hybrid-router.ts");
  assert.ok(source.includes("readonly userId: string"));
  assert.ok(source.includes("getEffectiveEntitlements(args.userId)"));
  assert.ok(source.includes("providerAccessTierForBillingPlan(entitlements.billingPlan)"));
  assert.ok(source.includes("ProviderRouter.createDefault(providerTier)"));
  assert.ok(!source.includes("ProviderRouter.createDefault();"));
});

test("all public hybrid-worker entry points bind fallback routing to the authenticated session user", () => {
  const chat = read("app/api/local-ai/chat/route.ts");
  const lead = read("app/api/local-ai/business/lead/route.ts");
  const email = read("app/api/local-ai/business/email/route.ts");
  const workers = read("src/services/local-ai/business-workers.ts");

  assert.ok(chat.includes("userId: session.user.id"), "local chat must pass the authenticated user to hybrid routing");
  assert.ok(lead.includes("runLeadWorker(parsed.data, session.user.id)"), "lead worker must bind to the authenticated user");
  assert.ok(email.includes("runEmailWorker(parsed.data, session.user.id)"), "email worker must bind to the authenticated user");
  assert.ok(workers.includes("userId: args.userId"), "business workers must forward the authenticated user to hybrid routing");
});

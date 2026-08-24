import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("compare API requires Pro-or-higher entitlement before exposing providers", () => {
  const source = read("app/api/compare/route.ts");

  assert.ok(source.includes('BillingPlan.PRO'), "Compare must use Pro as the minimum billing plan");
  assert.ok(source.includes('assertMinPlan(userId, BillingPlan.PRO)'), "Compare must enforce paid entitlement server-side");
  assert.ok(source.includes('async function requireCompareAccess'), "Compare must centralize the entitlement guard");

  const getStart = source.indexOf("export async function GET");
  const postStart = source.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET and POST handlers must exist");

  const getBody = source.slice(getStart, postStart);
  const postBody = source.slice(postStart);
  assert.ok(getBody.includes("await requireCompareAccess(session.user.id)"), "GET must gate provider discovery for FREE users");
  assert.ok(postBody.includes("await requireCompareAccess(session.user.id)"), "POST must gate provider execution for FREE users");
});

test("compare paid-provider execution remains server-selected from a fixed provider allowlist", () => {
  const source = read("app/api/compare/route.ts");

  assert.ok(
    source.includes('z.enum(["openai", "nvidia", "self-hosted"])'),
    "Compare provider IDs must remain constrained by a server-side allowlist",
  );
  assert.ok(!source.includes("billingPlan:"), "Compare must not accept a client-supplied billing plan");
  assert.ok(!source.includes("providerTier:"), "Compare must not accept a client-supplied provider tier");
});

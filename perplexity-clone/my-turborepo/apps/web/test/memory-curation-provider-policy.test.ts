import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("persistent memory curation uses no model router under confirmation-only policy", () => {
  const source = read("lib/persistent-memory-core.ts");

  assert.ok(
    !source.includes("getEffectiveEntitlements("),
    "automatic memory curation must not call entitlements service under confirmation-only policy",
  );
  assert.ok(
    !source.includes("ProviderRouter."),
    "automatic memory curation must not construct an LLM router",
  );
});

test("persistent memory curation cannot silently fall back to the Pro default router", () => {
  const source = read("lib/persistent-memory-core.ts");
  assert.ok(
    !source.includes("ProviderRouter.createDefault();"),
    "a bare createDefault() would silently route FREE memory curation through the Pro default",
  );
});

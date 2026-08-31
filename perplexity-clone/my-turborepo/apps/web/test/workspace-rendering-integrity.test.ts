import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("workspace frame is isolated from deprecated research-stage CSS", () => {
  const frame = read("components/AiraV2Frame.tsx");
  const css = read("app/aira-v2.css");

  assert.ok(frame.includes("aira-v2-workspace-stage"), "workspace frame must use its isolated stage class");
  assert.ok(!frame.includes('className="aira-v2-stage"'), "workspace pages must never re-enter deprecated research-stage selectors");
  assert.ok(!css.includes(".aira-v2-stage"), "the narrow SearchLayout bridge must not contain the retired destructive stage selector");
  assert.ok(css.includes(".aira-core-search"), "the remaining bridge should be explicitly scoped to SearchLayout");
});

test("all framed workspaces render real connected content below the shared shell", () => {
  const pages = [
    ["app/knowledge/page.tsx", "/api/knowledge/library"],
    ["app/settings/page.tsx", "/api/integrations/status"],
    ["app/compare/page.tsx", "/api/compare"],
    ["app/local-ai/page.tsx", "/api/local-ai/status"],
    ["app/runs/page.tsx", "/api/agents/runs"],
    ["app/workspace-search/page.tsx", "/api/global-search"],
  ] as const;

  for (const [file, capability] of pages) {
    const source = read(file);
    assert.ok(source.includes("<AiraV2Frame>"), `${file} must remain inside the shared workspace shell`);
    assert.ok(source.includes(capability), `${file} must remain connected to ${capability}`);
  }
});

test("pricing remains a real public comparison page", () => {
  const proxy = read("proxy.ts");
  const pricing = read("app/pricing/page.tsx");

  assert.ok(proxy.includes('pathname === "/pricing"'), "pricing must bypass the authenticated workspace redirect");
  assert.ok(pricing.includes("Start free"), "public pricing should expose the guest start path");
  assert.ok(pricing.includes("Upgrade to Pro"));
  assert.ok(pricing.includes("Choose Team"));
  assert.ok(pricing.includes('fetch("/api/billing/status"'));
});

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
  assert.ok(css.includes('.aira-v2-stage main > div:first-child { display: none !important; }'), "test should continue protecting against the known destructive legacy selector until it is removed");
});

test("all framed workspaces render real content below the shared shell", () => {
  const pages = [
    ["app/knowledge/page.tsx", "Files that AIRA can actually use"],
    ["app/settings/page.tsx", "Runtime & integrations"],
    ["app/compare/page.tsx", "Compare models side by side"],
    ["app/omniroute/page.tsx", "Universal inference gateway"],
    ["app/runs/page.tsx", "Run"],
    ["app/workspace-search/page.tsx", "search"],
  ] as const;

  for (const [file, marker] of pages) {
    const source = read(file);
    assert.ok(source.includes("<AiraV2Frame>"), `${file} must remain inside the shared workspace shell`);
    assert.ok(source.toLowerCase().includes(marker.toLowerCase()), `${file} must contain its workspace content marker`);
  }
});

test("retired Local AI route redirects to OmniRoute", () => {
  const compatibilityRoute = read("app/local-ai/page.tsx");
  assert.ok(compatibilityRoute.includes('redirect("/omniroute")'));
  assert.ok(!compatibilityRoute.includes("<AiraV2Frame>"), "the retired Local AI page should not render a second workspace");
});

test("pricing remains a real public comparison page", () => {
  const proxy = read("proxy.ts");
  const pricing = read("app/pricing/page.tsx");

  assert.ok(proxy.includes('pathname === "/pricing"'), "pricing must bypass the authenticated workspace redirect");
  assert.ok(pricing.includes("Start free"), "public pricing should expose the guest start path");
  assert.ok(pricing.includes("Upgrade to Pro"));
  assert.ok(pricing.includes("Choose Team"));
});

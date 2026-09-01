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
  const pricingLayout = read("app/pricing/layout.tsx");
  const legacySurfaces = read("app/impeccable-surfaces.css");

  assert.ok(proxy.includes('pathname === "/pricing"'), "pricing must bypass the authenticated workspace redirect");
  assert.ok(pricing.includes("Start free"), "public pricing should expose the guest start path");
  assert.ok(pricing.includes("Upgrade to Pro"));
  assert.ok(pricing.includes("Choose Team"));
  assert.ok(pricing.includes('fetch("/api/billing/status"'));
  assert.ok(!pricingLayout.includes("impeccable-surfaces.css"));
  assert.ok(!pricingLayout.includes("aira-pricing-surface"));
  assert.ok(!legacySurfaces.includes(".aira-pricing-surface"));
  assert.ok(legacySurfaces.includes("color-scheme: dark"));
  assert.ok(legacySurfaces.includes("--aira-text: 60 7% 94%"));
});

test("production surfaces use truthful status copy and accessible control semantics", () => {
  const frame = read("components/AiraV2Frame.tsx");
  const agents = read("components/agents/AgentDashboard.tsx");
  const runs = read("app/runs/page.tsx");
  const share = read("components/share/ShareFollowUpCta.tsx");
  const localAi = read("app/local-ai/page.tsx");
  const settings = read("app/settings/page.tsx");
  const controlCenter = read("app/control-center/page.tsx");
  const billing = read("lib/billing/plan-enforcement.ts");
  const memory = read("components/memory/MemoryManager.tsx");
  const integrationStatus = read("app/api/integrations/status/route.ts");
  const providerRouter = read("src/services/providers/provider-router.ts");

  assert.ok(frame.includes("paletteRef"), "command palette should trap focus within its dialog");
  assert.ok(agents.includes('aria-labelledby="new-agent-task-heading"'));
  assert.ok(runs.includes('aria-label="Autonomous run objective"'));
  assert.ok(share.includes('aria-label="Follow-up question"'));
  assert.ok(localAi.includes('role="group"'));
  assert.ok(localAi.includes("aria-pressed"));
  assert.ok(!localAi.includes('role="tablist"'));
  assert.ok(!settings.includes("Connected services"));
  assert.ok(!controlCenter.includes("Connected stack"));
  assert.ok(!billing.includes("unlimited searches"));
  assert.ok(memory.includes("This action cannot be undone"));
  assert.ok(!settings.includes("operational readiness"));
  assert.ok(settings.includes("not an uptime guarantee"));
  assert.ok(integrationStatus.includes("googleClientId() && googleClientSecret()"));
  assert.ok(integrationStatus.includes("githubClientId() && githubClientSecret()"));
  assert.ok(providerRouter.includes("getLocalAiConfigOrDisabled"));
  assert.ok(!providerRouter.includes("selfHostedBaseURL && selfHostedApiKey && selfHostedModel"));
});

test("the package test command runs the suite on Windows and POSIX shells", () => {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: { test?: string } };
  assert.equal(packageJson.scripts?.test, "node --import ./test/resolver.mjs --test test/*.test.ts");
});

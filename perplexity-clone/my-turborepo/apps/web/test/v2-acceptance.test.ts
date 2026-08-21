import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

const page = source("app/v2/page.tsx");
const layout = source("app/v2/layout.tsx");
const app = source("src/v2/components/aira/AiraApp.tsx");
const header = source("src/v2/components/aira/AiraHeader.tsx");
const footer = source("src/v2/components/aira/AiraFooter.tsx");
const logo = source("src/v2/components/aira/AiraLogo.tsx");
const banner = source("src/v2/components/aira/AiraAnnouncementBanner.tsx");
const compat = source("src/v2/compat/aira-api.ts");
const account = source("src/v2/compat/account-api.ts");
const settings = source("src/v2/components/modules/SettingsWorkspacePanel.tsx");
const library = source("src/v2/components/modules/LibraryWorkspacePanel.tsx");
const mobileContext = source("src/v2/components/MobileContextSheet.tsx");
const styles = [
  source("app/v2/aira.css"),
  source("app/v2/aira-shell.css"),
  source("app/v2/aira-workspace.css"),
  source("app/v2/aira-modules.css"),
  source("app/v2/aira-library.css"),
  source("app/v2/aira-responsive.css"),
].join("\n");
const proxy = source("proxy.ts");

const replacementSurface = [page, layout, app, header, footer, logo, banner, styles].join("\n");

test("uses the uploaded warm AIRA AI shell as the only V2 visual surface", () => {
  assert.match(page, /AiraApp/);
  assert.match(layout, /\.\/aira\.css/);
  assert.doesNotMatch(layout, /v2\.css|modules\.css|v2-next\.css/);
  assert.match(app, /What can I do for you\?/);
  assert.match(app, /Assign a task or ask anything/);
  assert.match(styles, /#f8f8f7/);
  assert.match(styles, /border-radius:\s*22px/);
  assert.match(styles, /\.aira-footer/);
  assert.match(source("app/v2/aira.css"), /aira-shell\.css/);
  assert.match(source("app/v2/aira.css"), /aira-responsive\.css/);
});

test("removes every source-brand reference from the replacement frontend", () => {
  const forbiddenBrand = new RegExp(["ma", "nus"].join(""), "i");
  assert.doesNotMatch(replacementSurface, forbiddenBrand);
  assert.match(logo, /AIRA AI/);
  assert.match(footer, /© 2026 AIRA AI/);
  assert.match(layout, /AIRA AI/);
});

test("keeps V2 public for the existing anonymous research flow without opening private APIs", () => {
  assert.match(proxy, /pathname === "\/v2"/);
  assert.match(proxy, /pathname\.startsWith\("\/v2\/"\)/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/billing"\)/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/history"\)/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/share"\)/);
});

test("keeps research, history, follow-ups, presets and branching on the existing backend", () => {
  assert.match(compat, /\/api\/search/);
  assert.match(compat, /\/api\/history\/research/);
  assert.match(compat, /continueResearch/);
  assert.match(app, /presetId/);
  assert.match(app, /Branch from here/);
  assert.match(app, /parentMessageId/);
  assert.match(app, /ResearchHistoryPanel/);
});

test("keeps account, memory, agents, artifacts, and sharing behind existing APIs", () => {
  for (const route of ["/api/agents/runs", "/api/memory"]) {
    assert.ok(compat.includes(route), `V2 compatibility client must use ${route}`);
  }
  assert.match(account, /\/api\/billing\/status/);
  assert.match(account, /\/api\/share/);
  assert.match(settings, /billing/);
  assert.match(library, /Version history/);
  assert.match(library, /agentWorkspaceFilePaths/);
  assert.match(app, /AgentWorkspacePanel/);
  assert.match(app, /MemoryWorkspacePanel/);
  assert.match(app, /LibraryWorkspacePanel/);
  assert.match(app, /SettingsWorkspacePanel/);
});

test("is provider-generic so AAE can surface without another frontend rewrite", () => {
  assert.match(compat, /provider === "AAE"/);
  assert.match(compat, /AIRA Agent Engine/);
  assert.match(app, /AgentWorkspacePanel/);
});

test("ships explicit accessibility and mobile-context contracts", () => {
  assert.match(app, /Skip to main content/);
  assert.match(app, /id="aira-main"/);
  assert.match(app, /aria-live="polite"/);
  assert.match(header, /aria-label="AIRA AI navigation"/);
  assert.match(mobileContext, /role="dialog"/);
  assert.match(mobileContext, /aria-modal="true"/);
  assert.match(mobileContext, /event\.key === "Escape"/);
  assert.match(mobileContext, /event\.key !== "Tab"/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /@media \(max-width: 640px\)/);
});

test("does not move authorization or persistence into the replacement client", () => {
  for (const forbidden of ["@prisma/client", "@/lib/prisma", "foundation-control-plane", "safety-gateway", "plan-enforcement"]) {
    assert.ok(!app.includes(forbidden), `AIRA frontend must not import ${forbidden}`);
    assert.ok(!compat.includes(forbidden), `V2 compatibility client must not import ${forbidden}`);
  }
});

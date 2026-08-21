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
const workspace = source("src/v2/components/AiraV2WorkspaceFinal.tsx");
const compat = source("src/v2/compat/aira-api.ts");
const settings = source("src/v2/components/modules/SettingsWorkspacePanel.tsx");
const library = source("src/v2/components/modules/LibraryWorkspacePanel.tsx");
const mobileContext = source("src/v2/components/MobileContextSheet.tsx");
const styles = source("app/v2/v2-next.css");

test("serves the finalized V2 workspace without replacing the production root", () => {
  assert.match(page, /AiraV2WorkspaceFinal/);
  assert.doesNotMatch(page, /redirect\s*\(/);
  assert.match(workspace, /href="\/"/);
  assert.match(workspace, /Current AIRA/);
});

test("keeps research parity behind the existing compatibility API", () => {
  assert.match(compat, /\/api\/search/);
  assert.match(compat, /\/api\/history\/research/);
  assert.match(compat, /continueResearch/);
  assert.match(workspace, /presetId/);
  assert.match(workspace, /Branch from here/);
  assert.match(workspace, /parentMessageId/);
  assert.match(workspace, /ResearchHistoryPanel/);
});

test("keeps account, memory, agents, artifacts, and sharing behind existing APIs", () => {
  for (const route of ["/api/agents/runs", "/api/memory"]) {
    assert.match(compat, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const account = source("src/v2/compat/account-api.ts");
  assert.match(account, /\/api\/billing\/status/);
  assert.match(account, /\/api\/share/);
  assert.match(settings, /billing/);
  assert.match(library, /Version history/);
  assert.match(library, /agentWorkspaceFilePaths/);
});

test("is provider-generic so AAE can surface without another frontend rewrite", () => {
  assert.match(compat, /provider === "AAE"/);
  assert.match(workspace, /AgentRuntimeStatusStrip/);
  const runtimeStrip = source("src/v2/components/modules/AgentRuntimeStatusStrip.tsx");
  assert.match(runtimeStrip, /Object\.entries\(dashboard\?\.feature\?\.providers/);
  assert.match(runtimeStrip, /including AAE/);
});

test("ships explicit accessibility and mobile-context contracts", () => {
  assert.match(workspace, /Skip to main content/);
  assert.match(workspace, /id="v2-main-content"/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /aria-label="AIRA V2 sections"/);
  assert.match(mobileContext, /role="dialog"/);
  assert.match(mobileContext, /aria-modal="true"/);
  assert.match(mobileContext, /event\.key === "Escape"/);
  assert.match(mobileContext, /event\.key !== "Tab"/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /@media \(max-width: 820px\)/);
});

test("does not move authorization or persistence into V2 client code", () => {
  for (const forbidden of ["@prisma/client", "@/lib/prisma", "foundation-control-plane", "safety-gateway", "plan-enforcement"]) {
    assert.ok(!workspace.includes(forbidden), `V2 workspace must not import ${forbidden}`);
    assert.ok(!compat.includes(forbidden), `V2 compatibility client must not import ${forbidden}`);
  }
});

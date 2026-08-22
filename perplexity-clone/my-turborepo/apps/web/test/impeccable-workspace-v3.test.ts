import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

test("root layout loads the unified workspace design layer", () => {
  const layout = read("app/layout.tsx");
  assert.ok(layout.includes('import "./impeccable-workspace-v3.css"'));
});

test("chat is full width and keeps a real conversation plus inspector layout", () => {
  const css = read("app/impeccable-workspace-v3.css");
  assert.ok(css.includes(".aira-home.aira-home .max-w-7xl"));
  assert.ok(css.includes("max-width: none !important"));
  assert.ok(css.includes("width: 360px !important"));
  assert.ok(css.includes("grid-template-columns: minmax(0, 1fr) 320px !important"));
  assert.ok(css.includes("max-width: 940px !important"));
});

test("authenticated workspace frame uses the compact application rail", () => {
  const css = read("app/impeccable-workspace-v3.css");
  assert.ok(css.includes("grid-template-columns: 88px minmax(0, 1fr) !important"));
  assert.ok(css.includes(".aira-v2-workspace-stage.aira-v2-workspace-stage"));
  assert.ok(css.includes("max-width: 1440px !important"));
});

test("agents and memory share the authenticated AIRA frame", () => {
  const agents = read("app/agents/page.tsx");
  const memory = read("app/memory/page.tsx");
  assert.ok(agents.includes("<AiraV2Frame>"));
  assert.ok(agents.includes("aira-agent-workspace aira-v2-page"));
  assert.ok(memory.includes("<AiraV2Frame>"));
  assert.ok(memory.includes("aira-memory-workspace aira-v2-page"));
  assert.ok(!memory.includes("<WorkspaceHeader"));
});

test("operational dark surfaces override legacy light content tokens", () => {
  const css = read("app/impeccable-workspace-v3.css");
  assert.ok(css.includes("--content-primary: 220 20% 95% !important"));
  assert.ok(css.includes("--content-secondary: 220 12% 72% !important"));
  assert.ok(css.includes("--memory-panel: #101725 !important"));
});

test("standalone workspace header no longer renders as a bright light bar", () => {
  const header = read("components/WorkspaceHeader.tsx");
  assert.ok(header.includes("aira-public-workspace-header"));
  assert.ok(header.includes("bg-[#080d16]/95"));
  assert.ok(!header.includes("bg-white/[0.74]"));
});

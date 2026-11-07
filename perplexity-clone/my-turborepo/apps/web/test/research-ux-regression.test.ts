import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("mobile navigation is hidden when closed and exposes its state and focus management", () => {
  const frame = read("components/AiraV2Frame.tsx");
  const css = read("app/aira-visual-redesign.css");
  assert.match(frame, /href="#aira-workspace-content"/);
  assert.match(frame, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(frame, /aria-controls="aira-workspace-navigation"/);
  assert.match(frame, /mobileNavTriggerRef/);
  assert.match(css, /#aira-workspace-navigation\[data-mobile-open="false"\] \{ visibility: hidden; \}/);
});

test("memory loading failure offers retry instead of claiming the list is empty", () => {
  const source = read("components/memory/MemoryManager.tsx");
  assert.match(source, /loadFailed \? null : memories\.length === 0/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-label="Memory content"/);
  assert.match(source, /aria-label="Delete memory"/);
});

test("agent loading failure does not masquerade as an empty history", () => {
  const source = read("components/agents/AgentDashboard.tsx");
  assert.match(source, /dashboardLoadFailed && runs\.length === 0/);
  assert.match(source, /Task history could not be loaded/);
  assert.match(source, /Status unavailable/);
});

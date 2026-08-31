import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(WEB_ROOT, relative), "utf8");

test("root layout no longer globally loads obsolete workspace override layers", () => {
  const layout = read("app/layout.tsx");
  assert.ok(layout.includes('import "./globals.css"'));
  assert.ok(!layout.includes('import "./impeccable-workspace-v3.css"'));
  assert.ok(!layout.includes('import "./aira-visual-redesign.css"'));
  assert.ok(layout.includes('localStorage.getItem("aira:theme")'));
});

test("global styles expose canonical AIRA semantic light and dark tokens", () => {
  const css = read("app/globals.css");
  for (const token of [
    "--aira-bg",
    "--aira-surface-1",
    "--aira-border",
    "--aira-text",
    "--aira-accent",
    "--aira-motion-micro",
  ]) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
  assert.ok(css.includes('html[data-theme="light"]'));
  assert.ok(css.includes('html[data-theme="dark"]'));
  assert.ok(!css.includes("radial-gradient(80% 55%"));
});

test("workspace shell is component scoped and keeps real navigation behavior", () => {
  const frame = read("components/AiraV2Frame.tsx");
  const css = read("components/AiraV2Frame.module.css");
  assert.ok(frame.includes('import styles from "./AiraV2Frame.module.css"'));
  assert.ok(frame.includes('label: "Ask AIRA"'));
  assert.ok(frame.includes('label: "Knowledge"'));
  assert.ok(frame.includes('label: "Agents"'));
  assert.ok(frame.includes('label: "Runs"'));
  assert.ok(frame.includes("aira:shell-collapsed"));
  assert.ok(frame.includes("<UserMenu />"));
  assert.ok(css.includes("--shell-rail: 252px"));
  assert.ok(css.includes("--shell-rail: 72px"));
  assert.ok(css.includes("@media (max-width: 768px)"));
});

test("core chat and composer use scoped AIRA styles instead of violet gradients", () => {
  const composer = read("components/SearchBox.tsx");
  const messages = read("components/conversations/ConversationMessageList.tsx");
  const sidebar = read("components/conversations/ConversationSidebar.tsx");
  assert.ok(composer.includes('import styles from "./SearchBox.module.css"'));
  assert.ok(messages.includes('import styles from "./ConversationMessageList.module.css"'));
  assert.ok(sidebar.includes('import styles from "./ConversationSidebar.module.css"'));
  assert.ok(!composer.includes("from-violet"));
  assert.ok(!messages.includes("from-violet"));
  assert.ok(!sidebar.includes("from-violet"));
  assert.ok(composer.includes('fetch("/api/model-preference"'));
});

test("home route retires the stacked legacy page design layers", () => {
  const page = read("app/page.tsx");
  assert.ok(page.includes('import "./aira-v2.css"'));
  assert.ok(page.includes('className="aira-core-search"'));
  assert.ok(!page.includes('import "./aira-reference.css"'));
  assert.ok(!page.includes('import "./impeccable-polish.css"'));
  assert.ok(!page.includes('import "./impeccable-chat-v2.css"'));
});

test("aira-v2 is now a narrow SearchLayout migration bridge rather than shell override CSS", () => {
  const css = read("app/aira-v2.css");
  assert.ok(css.includes("AIRA core workspace migration bridge"));
  assert.ok(css.includes(".aira-core-search"));
  assert.ok(!css.includes(".aira-v2-frame {"));
  assert.ok(!css.includes(".aira-v2-palette-backdrop"));
  assert.ok(!css.includes("background: #0b0d10"));
});

test("agents and memory continue to share the authenticated AIRA frame", () => {
  const agents = read("app/agents/page.tsx");
  const memory = read("app/memory/page.tsx");
  assert.ok(agents.includes("<AiraV2Frame>"));
  assert.ok(memory.includes("<AiraV2Frame>"));
});

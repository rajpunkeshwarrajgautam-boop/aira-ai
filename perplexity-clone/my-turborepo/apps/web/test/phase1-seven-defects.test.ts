import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("D1: AiraDeliverablesCanvas does not contain synthetic DEFAULT_STEPS with fake timings/endpoint counts", () => {
  const canvas = read("components/AiraDeliverablesCanvas.tsx");

  assert.ok(!canvas.includes("DEFAULT_STEPS"), "canvas must not define or use synthetic DEFAULT_STEPS");
  assert.ok(!canvas.includes("Crawled 48 authoritative endpoints"), "canvas must not fabricate endpoint counts");
  assert.ok(!canvas.includes('timestamp: "0.2s"'), "canvas must not fabricate execution step timings");
  assert.ok(canvas.includes("steps = []"), "canvas must default steps to an empty array");
  assert.ok(canvas.includes("No execution trace recorded"), "canvas must render honest empty state when no telemetry exists");
});

test("D2: ConversationMessageList does not use fixed confidence fallbacks (0.94 or 0.88)", () => {
  const messageList = read("components/conversations/ConversationMessageList.tsx");

  assert.ok(!messageList.includes("0.94"), "message list must not fabricate 94% confidence fallback");
  assert.ok(!messageList.includes("0.88"), "message list must not fabricate 88% confidence fallback");
  assert.ok(messageList.includes("hasCalibratedConfidence"), "message list must check for genuine calibrated confidence");
  assert.ok(messageList.includes("Source-Grounded"), "message list must use neutral Source-Grounded badge when citations exist");
});

test("D3: Settings page dynamically checks knowledge ingestion capability from integrations status", () => {
  const settings = read("app/settings/page.tsx");

  assert.ok(settings.includes('status.integrations?.find((i) => i.id === "knowledge")?.configured'), "settings must inspect real knowledge integration configured status");
  assert.ok(settings.includes("Disabled (Deployment Gate: Requires Ingestion Worker)"), "settings must indicate disabled gate when worker is unconfigured");
});

test("D4: OmniRoute page separates live gateway validation from historical baseline", () => {
  const omniroute = read("app/omniroute/page.tsx");

  assert.ok(omniroute.includes("Historical Baseline"), "omniroute must distinguish historical baseline from live validated");
  assert.ok(omniroute.includes("status?.connected ? \"Live validated\" : \"Historical Baseline\""), "live validated badge must depend on gateway connectivity");
  assert.ok(omniroute.includes("Boolean(status?.connected && preset.validated)"), "routing presets must be enabled only when gateway is connected");
});

test("D5: SearchLayout restores conversation state from ?conversation= and ?thread= query params", () => {
  const searchLayout = read("components/SearchLayout.tsx");

  assert.ok(searchLayout.includes('searchParams.get("conversation")?.trim() || searchParams.get("thread")?.trim()'), "search layout must read conversation or thread URL parameter");
  assert.ok(searchLayout.includes("void onSelectConversation(convParam)"), "search layout must trigger onSelectConversation when query param changes");
  assert.ok(searchLayout.includes("convParam === selectedConversationId"), "search layout must avoid redundant conversation re-selection");
});

test("D6: AiraV2Frame isActivePath prevents /workspace-search from matching /work prefix", () => {
  const frame = read("components/AiraV2Frame.tsx");

  assert.ok(frame.includes('pathname === route || pathname.startsWith(route + "/")'), "isActivePath must require exact match or slash prefix boundary");

  // Direct logical assertion on the boundary logic:
  function isActivePath(pathname: string, href: string): boolean {
    const route = href.split(/[?#]/, 1)[0] || "/";
    return route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(route + "/");
  }

  assert.strictEqual(isActivePath("/workspace-search", "/work"), false, "/workspace-search must NOT match /work");
  assert.strictEqual(isActivePath("/workspace-search", "/workspace-search"), true, "/workspace-search must match /workspace-search");
  assert.strictEqual(isActivePath("/work", "/work"), true, "/work must match /work");
  assert.strictEqual(isActivePath("/work/run-123", "/work"), true, "/work/run-123 must match /work");
});

test("D7: AiraDeliverablesCanvas does not unconditionally claim Cryptographically Grounded in citations tab", () => {
  const canvas = read("components/AiraDeliverablesCanvas.tsx");

  assert.ok(!canvas.includes('<span className="text-emerald-400">Cryptographically Grounded</span>'), "canvas must not unconditionally claim cryptographic grounding for ordinary web sources");
  assert.ok(canvas.includes('citations.length > 0 ? "Retrieved Sources" : "No Citations"'), "canvas must truthfully describe citations as retrieved sources");
});

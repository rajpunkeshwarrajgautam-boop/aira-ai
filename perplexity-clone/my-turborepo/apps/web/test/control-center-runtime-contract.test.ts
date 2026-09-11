import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("Control Center uses the canonical OmniRoute health contract", () => {
  const page = read("app/control-center/page.tsx");

  assert.ok(page.includes('fetch(url, { cache: "no-store", credentials: "include" })'));
  assert.ok(page.includes('readJson<OmniRoutePayload>("/api/omniroute/status", "OmniRoute")'));
  assert.ok(!page.includes("/api/local-ai/status"), "retired Local AI telemetry must not return to Control Center");
  assert.ok(page.includes("payload.connected ? \"Connected\" : \"Unavailable\""));
  assert.ok(page.includes("Configuration state only; live health is asserted separately"));
});

test("OmniRoute status proves live gateway health instead of configuration-only success", () => {
  const route = read("app/api/omniroute/status/route.ts");

  assert.ok(route.includes("fetchOmniRouteModels()"));
  assert.ok(route.includes("connected: true"));
  assert.ok(route.includes("connected: false"));
  assert.ok(route.includes("configured: false"));
  assert.ok(route.includes("latencyMs: snapshot.latencyMs"));
});

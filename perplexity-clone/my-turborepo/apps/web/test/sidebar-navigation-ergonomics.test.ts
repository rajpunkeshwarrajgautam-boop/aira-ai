import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraV2Frame satisfies modern mobile drawer width and viewport scrolling", () => {
  const framePath = path.resolve(
    process.cwd(),
    "components/AiraV2Frame.tsx"
  );
  const content = fs.readFileSync(framePath, "utf8");

  // Mobile drawer width must be at least 280px (not fixed 240px)
  assert.ok(
    content.includes("w-[280px]") || content.includes("w-[85vw]"),
    "Mobile drawer must be wide enough for modern mobile screens"
  );

  // Bottom navigation items must remain accessible
  assert.ok(
    content.includes("overflow-y-auto") && content.includes("Settings"),
    "Sidebar must ensure Settings is accessible without off-screen clipping"
  );
});

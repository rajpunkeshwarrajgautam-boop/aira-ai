import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraPreloader eliminates blocking 1500ms delay and supports instant unmount", () => {
  const preloaderPath = path.resolve(
    process.cwd(),
    "components/AiraPreloader.tsx"
  );
  const content = fs.readFileSync(preloaderPath, "utf8");

  // Must not have hardcoded 1500ms delay blocking interaction
  assert.doesNotMatch(
    content,
    /duration\s*=\s*shouldReduceMotion\s*\?\s*0\s*:\s*1500/,
    "Preloader must not enforce a 1500ms blocking interaction delay"
  );

  // Must have pointer-events-none so it never blocks user clicks
  assert.match(
    content,
    /pointer-events-none/,
    "Preloader must have pointer-events-none so it never intercepts user interactions"
  );
});

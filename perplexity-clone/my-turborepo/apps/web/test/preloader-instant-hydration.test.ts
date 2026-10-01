import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraPreloader remains non-blocking while the opening animation is visible", () => {
  const preloaderPath = path.resolve(
    process.cwd(),
    "components/AiraPreloader.tsx"
  );
  const content = fs.readFileSync(preloaderPath, "utf8");

  // The logo path animation lasts 1 second and the wordmark enters after 300ms,
  // so the preloader must remain visible long enough for both to be perceived.
  assert.match(
    content,
    /duration\s*=\s*shouldReduceMotion\s*\?\s*0\s*:\s*1500/,
    "Preloader must remain visible long enough for the opening animation to complete"
  );

  // The visual overlay must never block an already-hydrated workspace.
  assert.match(
    content,
    /pointer-events-none/,
    "Preloader must not intercept user interactions"
  );

  // Preserve the premium fade/blur exit instead of an abrupt 100ms flash.
  assert.match(
    content,
    /filter:\s*"blur\(10px\)"/,
    "Preloader should retain the intended blur exit"
  );
});

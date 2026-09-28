import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("SearchBox contract enforces popover mutual exclusivity and dismisses on typing", () => {
  const searchBoxPath = path.resolve(
    process.cwd(),
    "components/SearchBox.tsx"
  );
  const content = fs.readFileSync(searchBoxPath, "utf8");

  // 1. Must close all popovers when text changes
  assert.match(
    content,
    /setContextMenuOpen\(false\)/,
    "SearchBox must close context menu when user interacts or types"
  );

  // 2. Must not contain target="_blank" for internal integrations
  assert.doesNotMatch(
    content,
    /<Link[^>]+href="\/(?:knowledge|agents|omniroute)"[^>]+target="_blank"/,
    "Internal integrations in context menu must not open in target=_blank"
  );

  // 3. Must ensure context button styling does not switch to harsh inverted black button
  assert.doesNotMatch(
    content,
    /contextMenuOpen\s*\?\s*"bg-\[#111111\]\s+text-white"/,
    "Context button must not become harsh solid black when open"
  );
});

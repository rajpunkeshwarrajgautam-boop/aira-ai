import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AiraV2Frame removes fake unread notification dot from disabled button and signin clips bleed", () => {
  const framePath = path.resolve(
    process.cwd(),
    "components/AiraV2Frame.tsx"
  );
  const content = fs.readFileSync(framePath, "utf8");

  // Disabled notification bell must not have a fake badge dot
  assert.doesNotMatch(
    content,
    /<button[^>]+disabled[^>]+aria-label="Notifications[^"]*"[^>]*>[\s\S]*?<span[^>]+rounded-full[^>]+bg-\[#111111\]/,
    "Disabled notification bell must not render a misleading unread badge indicator"
  );

  const signinPath = path.resolve(
    process.cwd(),
    "app/signin/page.tsx"
  );
  const signinContent = fs.readFileSync(signinPath, "utf8");
  assert.match(
    signinContent,
    /overflow-hidden/,
    "Sign-in modal section must have overflow-hidden to prevent decorative bleed"
  );
});

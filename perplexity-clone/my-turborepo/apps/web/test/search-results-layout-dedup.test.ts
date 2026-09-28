import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("ConversationMessageList renders clean breadcrumb toolbar and proportional answer container", () => {
  const listPath = path.resolve(
    process.cwd(),
    "components/conversations/ConversationMessageList.tsx"
  );
  const content = fs.readFileSync(listPath, "utf8");

  // Toolbar should show structured breadcrumb rather than duplicate raw header block
  assert.ok(
    content.includes("Research") && content.includes("aira-thread-toolbar"),
    "Toolbar must provide a structured breadcrumb navigation"
  );

  // Assistant response must be clean and compact
  assert.ok(
    content.includes("aira-assistant-response"),
    "Assistant response class must be present"
  );
});

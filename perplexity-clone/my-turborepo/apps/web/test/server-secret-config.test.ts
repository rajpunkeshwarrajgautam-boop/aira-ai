import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../..");

function readSource(relativePath: string): string {
	return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("Auth.js secrets remain server-only and are never exported through Next.js env", () => {
	const source = readSource("perplexity-clone/my-turborepo/apps/web/next.config.js");

	assert.doesNotMatch(
		source,
		/\b(?:AUTH_SECRET|NEXTAUTH_SECRET)\s*:/,
		"auth secrets must not be placed in next.config.js env because Next.js inlines configured env values into JavaScript bundles",
	);
	assert.doesNotMatch(
		source,
		/build_fallback_secret/i,
		"next.config.js must not contain a fixed fallback authentication secret",
	);
});

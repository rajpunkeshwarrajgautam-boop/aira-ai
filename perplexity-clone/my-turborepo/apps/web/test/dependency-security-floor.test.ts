import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../..");

function readJson(relativePath: string): { dependencies?: Record<string, string> } {
	return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8")) as {
		dependencies?: Record<string, string>;
	};
}

function numericVersion(value: string): readonly number[] {
	const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
	assert.ok(match, `expected a pinned semantic version, received ${value}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, minimum: string): boolean {
	const left = numericVersion(actual);
	const right = numericVersion(minimum);
	for (let index = 0; index < 3; index += 1) {
		if (left[index] > right[index]) return true;
		if (left[index] < right[index]) return false;
	}
	return true;
}

test("production framework dependencies stay above the September 2026 security floors", () => {
	const web = readJson("perplexity-clone/my-turborepo/apps/web/package.json");
	const docs = readJson("perplexity-clone/my-turborepo/apps/docs/package.json");
	const workspace = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
	const sharpOverride = workspace.match(/^\s*sharp:\s*([^\s#]+)\s*$/m)?.[1];

	assert.ok(web.dependencies?.next, "web Next.js dependency must exist");
	assert.ok(docs.dependencies?.next, "docs Next.js dependency must exist");
	assert.ok(atLeast(web.dependencies.next, "16.3.3"), `web Next.js security floor regressed: ${web.dependencies.next}`);
	assert.ok(atLeast(docs.dependencies.next, "16.3.3"), `docs Next.js security floor regressed: ${docs.dependencies.next}`);
	assert.ok(sharpOverride, "workspace sharp override must exist");
	assert.ok(atLeast(sharpOverride, "0.35.4"), `sharp security floor regressed: ${sharpOverride}`);
});

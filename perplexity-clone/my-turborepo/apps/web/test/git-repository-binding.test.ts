import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

async function source(relative: string): Promise<string> {
	return readFile(path.join(ROOT, relative), "utf8");
}

test("git worktree creation resolves repository authority from the owned project", async () => {
	const adapter = await source("lib/tool-gateway/adapters.ts");
	assert.match(adapter, /getProjectForUser\(context\.userId, context\.projectId\)/);
	assert.match(adapter, /projectRepositoryBinding\(project\.config\)/);
	assert.match(adapter, /WORKTREE_REPOSITORY_UNBOUND/);
	assert.match(adapter, /WORKTREE_REPOSITORY_OVERRIDE_DENIED/);
	assert.match(adapter, /requestedRepository !== binding\.repositoryUrl/);
	assert.match(adapter, /parsed\.data\.baseRef !== binding\.baseRef/);
});

test("caller repository input can never be passed to the privileged worker", async () => {
	const adapter = await source("lib/tool-gateway/adapters.ts");
	assert.match(adapter, /repositoryUrl:\s*binding\.repositoryUrl/);
	assert.match(adapter, /baseRef:\s*binding\.baseRef/);
	assert.doesNotMatch(adapter, /repositoryUrl:\s*parsed\.data\.repositoryUrl/);
	assert.match(adapter, /metadata:\s*\{\s*repositoryHost:\s*binding\.repositoryHost,\s*repositoryUrl:\s*binding\.repositoryUrl\s*\}/);
	assert.match(adapter, /record\.metadata\.repositoryUrl !== binding\.repositoryUrl/);
});

test("repository canonicalization fails closed for credential-bearing and non-HTTPS URLs", async () => {
	const adapter = await source("lib/tool-gateway/adapters.ts");
	assert.match(adapter, /url\.protocol !== "https:" \|\| url\.username \|\| url\.password \|\| url\.search \|\| url\.hash/);
	assert.match(adapter, /parts\.length < 2/);
	assert.match(adapter, /endsWith\("\.git"\)/);
	assert.match(adapter, /safeBaseRef/);
});

test("same-host different-repository override is denied by exact canonical URL equality", async () => {
	const adapter = await source("lib/tool-gateway/adapters.ts");
	assert.match(adapter, /requestedRepository !== binding\.repositoryUrl/);
	assert.doesNotMatch(adapter, /requestedHost\s*!==\s*binding\.repositoryHost/);
});

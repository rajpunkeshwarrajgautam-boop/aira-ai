import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runtimeHasControlledTools } from "../lib/agent-runtime/tool-bridge";

const ROOT = process.cwd();

async function source(relative: string): Promise<string> {
	return readFile(path.join(ROOT, relative), "utf8");
}

test("controlled runtime capability is explicit and fail-closed", () => {
	const previous = process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES;
	try {
		delete process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES;
		assert.equal(runtimeHasControlledTools("DEERFLOW"), false);
		process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES = "DEERFLOW,AGENT_SWARM";
		assert.equal(runtimeHasControlledTools("DEERFLOW"), true);
		assert.equal(runtimeHasControlledTools("AGENT_SWARM"), true);
		assert.equal(runtimeHasControlledTools("AUTOGPT"), false);
	} finally {
		if (previous === undefined) delete process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES;
		else process.env.AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES = previous;
	}
});

test("runtime bridge uses a dedicated restricted credential", async () => {
	const route = await source("app/api/internal/tool-gateway/runtime/route.ts");
	assert.match(route, /AIRA_RUNTIME_TOOL_GATEWAY_TOKEN/);
	assert.doesNotMatch(route, /const expected = process\.env\.AIRA_TOOL_GATEWAY_TOKEN/);
	assert.match(route, /allowedTools/);
	assert.match(route, /runtimeHasControlledTools/);
});

test("coding specialists provision worktrees through the Tool Gateway and block unsafe fallback", async () => {
	const orchestrator = await source("lib/agent-platform/orchestrator.ts");
	for (const role of ["FRONTEND", "BACKEND", "DATABASE", "SECURITY", "INTEGRATOR"]) {
		assert.match(orchestrator, new RegExp(`CONTROLLED_WORKTREE_ROLES[\\s\\S]*${role}`));
	}
	assert.match(orchestrator, /executeTool\([\s\S]*tool:\s*"git"[\s\S]*action:\s*"create_worktree"/);
	assert.match(orchestrator, /runtime\.capabilities\.controlledTools/);
	assert.match(orchestrator, /setTaskStatus\(input\.task\.id,\s*"BLOCKED"\)/);
	assert.match(orchestrator, /AgentInstance[\s\S]*"workspace"/);
	assert.match(orchestrator, /relatedWorkspaces/);
});

test("runtime bridge secrets remain server-only in the documented environment contract", async () => {
	const env = await readFile(path.join(ROOT, "../../../../.env.example"), "utf8");
	assert.match(env, /^AIRA_RUNTIME_TOOL_GATEWAY_TOKEN=$/m);
	assert.match(env, /^AIRA_AGENT_CONTROLLED_TOOL_RUNTIMES=$/m);
	assert.doesNotMatch(env, /^NEXT_PUBLIC_AIRA_RUNTIME_TOOL_GATEWAY_TOKEN=/m);
});

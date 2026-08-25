import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { z } from "zod";

import {
	ToolExecutionPolicyError,
	ToolRegistry,
} from "../lib/agents/tools/tool-registry";
import { decideToolInvocation } from "../lib/tools/contracts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("tool approval modes fail conservative for side effects", () => {
	assert.equal(decideToolInvocation("auto", "READ"), "EXECUTE");
	assert.equal(decideToolInvocation("auto", "WRITE"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("auto", "CODE_EXECUTION"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("auto", "BROWSER_ACTION"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("auto", "HIGH_IMPACT"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("ask", "READ"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("plan_only", "READ"), "PLAN_ONLY");
	assert.equal(decideToolInvocation("plan_only", "HIGH_IMPACT"), "PLAN_ONLY");
});

test("canonical executor blocks privileged tools without persisted proof", async () => {
	const registry = new ToolRegistry();
	let executions = 0;
	registry.registerTool({
		name: "write_test",
		description: "test-only mutation",
		category: "test",
		requiresAuth: true,
		requiresPermission: true,
		inputSchema: z.object({ value: z.string() }),
		execute: async ({ value }) => {
			executions += 1;
			return { value };
		},
	});

	await assert.rejects(
		registry.executeTool("write_test", { value: "blocked" }),
		(error: unknown) =>
			error instanceof ToolExecutionPolicyError && error.code === "TOOL_APPROVAL_REQUIRED",
	);
	assert.equal(executions, 0);

	const source = readWeb("lib/agents/tools/tool-registry.ts");
	assert.ok(!source.includes("approvalGranted"));
	assert.ok(source.includes("hasApprovedToolAction"));
	assert.ok(source.includes("requestToolApproval"));
	assert.ok(source.includes("approvalRequest"));
});

test("canonical executor honors plan_only even for read tools", async () => {
	const registry = new ToolRegistry();
	registry.registerTool({
		name: "read_test",
		description: "test-only read",
		category: "test",
		requiresAuth: true,
		requiresPermission: false,
		inputSchema: z.object({}),
		execute: async () => ({ ok: true }),
	});
	await assert.rejects(
		registry.executeTool("read_test", {}, undefined, { mode: "plan_only" }),
		(error: unknown) => error instanceof ToolExecutionPolicyError && error.code === "TOOL_PLAN_ONLY",
	);
});

test("AIRA has one canonical executable tool registry and one built-in registration path", () => {
	assert.equal(existsSync(path.join(WEB_ROOT, "lib/tools/registry.ts")), false);
	const source = readWeb("lib/agents/tools/tool-registry.ts");
	assert.ok(source.includes("export class ToolRegistry"));
	assert.ok(source.includes("export const globalToolRegistry = new ToolRegistry()"));
	assert.ok(source.includes("export async function registerBuiltInTools()"));
	assert.ok(source.includes('import("./webSearchTool")'));
	assert.ok(source.includes('import("./citationFormatTool")'));
	assert.ok(source.includes('import("./memoryLookupTool")'));
	assert.ok(source.includes('import("./calculatorTool")'));
	assert.ok(source.includes('import("./pythonSandboxTool")'));
	assert.ok(source.includes('import("../../mcp/runtime")'));
	assert.ok(source.includes("ensureMcpToolRegistered(this, name"));
});

test("registry exposes disabled runtime capabilities truthfully without duplicate ids", () => {
	const registry = new ToolRegistry();
	registry.registerTool({
		name: "calculator",
		description: "test-only read tool",
		category: "utility",
		requiresAuth: false,
		requiresPermission: false,
		inputSchema: z.object({ expression: z.string() }),
		execute: async () => ({ result: 1 }),
	});
	const tools = registry.publicDescriptors();
	const ids = tools.map((tool) => tool.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.ok(ids.includes("calculator"));
	const browser = tools.find((tool) => tool.id === "browser");
	assert.ok(browser);
	assert.equal(browser.availability.state, "UNAVAILABLE");
	assert.match(browser.availability.detail, /No production browser runtime/);
	const sandbox = tools.find((tool) => tool.id === "python_sandbox");
	assert.ok(sandbox);
	assert.equal(sandbox.permission, "CODE_EXECUTION");
});

test("configured web search is reported as configured rather than live healthy", () => {
	const previous = process.env.EXA_API_KEY;
	process.env.EXA_API_KEY = "test-only-placeholder";
	try {
		const registry = new ToolRegistry();
		registry.registerTool({
			name: "web_search",
			description: "test-only web search",
			category: "research",
			requiresAuth: true,
			requiresPermission: false,
			inputSchema: z.object({ query: z.string() }),
			execute: async () => ({ results: [] }),
		});
		const webSearch = registry.publicDescriptors().find((tool) => tool.id === "web_search");
		assert.ok(webSearch);
		assert.equal(webSearch.availability.state, "CONFIGURED");
		assert.match(webSearch.availability.detail, /Health is verified when the tool is invoked/);
	} finally {
		if (previous === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = previous;
	}
});

test("tool status endpoint is authenticated, no-store and returns user-scoped canonical descriptors", () => {
	const route = readWeb("app/api/tools/route.ts");
	assert.ok(route.includes("await auth()"));
	assert.ok(route.includes('code: "UNAUTHENTICATED"'));
	assert.ok(route.includes('"Cache-Control": "no-store"'));
	assert.ok(route.includes('from "@/lib/agents/tools/tool-registry"'));
	assert.ok(route.includes("getPublicToolDescriptors(session.user.id)"));
	assert.ok(!route.includes("process.env"));
});

test("settings distinguishes configured tools from live-connected services", () => {
	const page = readWeb("app/settings/page.tsx");
	assert.ok(page.includes('fetch("/api/tools"'));
	assert.ok(page.includes('fetch("/api/mcp"'));
	assert.ok(page.includes("Agent tool registry"));
	assert.ok(page.includes("Configured"));
	assert.ok(page.includes("does not claim live health"));
	assert.ok(page.includes("Auto mode only auto-executes read tools"));
	assert.ok(page.includes("Unknown remote MCP tools default to"));
});

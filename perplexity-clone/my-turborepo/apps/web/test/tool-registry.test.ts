import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { decideToolInvocation } from "../lib/tools/contracts";
import { createDefaultToolRegistry } from "../lib/tools/registry";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("tool approval modes fail conservative for side effects", () => {
	assert.equal(decideToolInvocation("auto", "READ"), "EXECUTE");
	assert.equal(decideToolInvocation("auto", "WRITE"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("auto", "CODE_EXECUTION"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("auto", "BROWSER_ACTION"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("ask", "READ"), "REQUIRE_APPROVAL");
	assert.equal(decideToolInvocation("plan_only", "READ"), "PLAN_ONLY");
	assert.equal(decideToolInvocation("plan_only", "HIGH_IMPACT"), "PLAN_ONLY");
});

test("default registry exposes one canonical definition per current capability", () => {
	const registry = createDefaultToolRegistry();
	const tools = registry.list();
	const ids = tools.map((tool) => tool.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(ids, ["web_search", "memory", "knowledge", "code_execution", "browser"]);
	assert.equal(registry.get("web_search")?.permission, "READ");
	assert.equal(registry.get("code_execution")?.permission, "CODE_EXECUTION");
	assert.equal(registry.get("browser")?.permission, "BROWSER_ACTION");
});

test("registry never claims the browser runtime is active before deployment", () => {
	const browser = createDefaultToolRegistry().publicDescriptors().find((tool) => tool.id === "browser");
	assert.ok(browser);
	assert.equal(browser.availability.state, "UNAVAILABLE");
	assert.match(browser.availability.detail, /No production browser runtime/);
});

test("configured credentials are reported as configured rather than live healthy", () => {
	const previous = process.env.EXA_API_KEY;
	process.env.EXA_API_KEY = "test-only-placeholder";
	try {
		const webSearch = createDefaultToolRegistry().publicDescriptors().find((tool) => tool.id === "web_search");
		assert.ok(webSearch);
		assert.equal(webSearch.availability.state, "CONFIGURED");
		assert.match(webSearch.availability.detail, /Health is verified when the tool is invoked/);
	} finally {
		if (previous === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = previous;
	}
});

test("tool status endpoint is authenticated, no-store and returns only public descriptors", () => {
	const route = readWeb("app/api/tools/route.ts");
	assert.ok(route.includes("await auth()"));
	assert.ok(route.includes('code: "UNAUTHENTICATED"'));
	assert.ok(route.includes('"Cache-Control": "no-store"'));
	assert.ok(route.includes("defaultToolRegistry.publicDescriptors()"));
	assert.ok(!route.includes("process.env"));
});

test("settings distinguishes configured tools from live-connected services", () => {
	const page = readWeb("app/settings/page.tsx");
	assert.ok(page.includes('fetch("/api/tools"'));
	assert.ok(page.includes("Agent tool registry"));
	assert.ok(page.includes("Configured"));
	assert.ok(page.includes("does not claim live health"));
	assert.ok(page.includes("Auto mode only auto-executes read tools"));
});

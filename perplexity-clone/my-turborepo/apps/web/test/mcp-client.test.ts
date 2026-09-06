import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseMcpServers } from "../lib/mcp/config";
import { isUnsafeMcpAddress, validateMcpEndpoint } from "../lib/mcp/network";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../../../..");

function readWeb(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function readRepo(relative: string): string {
	return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

test("MCP v2 uses the official split client package and removes the lock bootstrap workflow", () => {
	const packageJson = readWeb("package.json");
	const lockfile = readRepo("pnpm-lock.yaml");
	assert.match(packageJson, /"@modelcontextprotocol\/client": "2\.0\.0"/);
	assert.ok(!packageJson.includes("@modelcontextprotocol/sdk"));
	assert.ok(lockfile.includes("'@modelcontextprotocol/client@2.0.0'"));
	assert.equal(existsSync(path.join(REPO_ROOT, ".github/workflows/mcp-lock-probe.yml")), false);
});

test("MCP server config is bounded, deployment-owned and references only dedicated secret env names", () => {
	const parsed = parseMcpServers(JSON.stringify([
		{
			id: "docs",
			label: "Docs MCP",
			endpoint: "https://mcp.example.com/mcp",
			enabled: true,
			auth: { mode: "bearer", tokenEnv: "AIRA_MCP_SECRET_DOCS" },
			readOnlyTools: ["search", "search"],
			timeoutMs: 10_000,
			maxOutputBytes: 16_384,
		},
	]));
	assert.equal(parsed.length, 1);
	const server = parsed[0];
	assert.ok(server);
	assert.deepEqual(server.readOnlyTools, ["search"]);
	assert.equal(server.auth.mode, "bearer");

	assert.throws(() => parseMcpServers(JSON.stringify([
		{ id: "bad", label: "Bad", endpoint: "https://mcp.example.com/mcp", auth: { mode: "bearer", tokenEnv: "DATABASE_URL" } },
	])));
	assert.throws(() => parseMcpServers(JSON.stringify([
		{ id: "dup", label: "One", endpoint: "https://one.example.com/mcp" },
		{ id: "dup", label: "Two", endpoint: "https://two.example.com/mcp" },
	])));
});

test("MCP OAuth client credentials preserve explicit scopes and issuer pinning", () => {
	const parsed = parseMcpServers(JSON.stringify([
		{
			id: "oauth",
			label: "OAuth MCP",
			endpoint: "https://mcp.example.com/mcp",
			auth: {
				mode: "oauth_client_credentials",
				clientIdEnv: "AIRA_MCP_SECRET_OAUTH_CLIENT_ID",
				clientSecretEnv: "AIRA_MCP_SECRET_OAUTH_CLIENT_SECRET",
				scopes: ["tools.read", "tools.read", "tools.execute"],
				expectedIssuer: "https://auth.example.com/",
			},
		},
	]));
	const server = parsed[0];
	assert.ok(server);
	assert.equal(server.auth.mode, "oauth_client_credentials");
	if (server.auth.mode === "oauth_client_credentials") {
		assert.deepEqual(server.auth.scopes, ["tools.read", "tools.execute"]);
		assert.equal(server.auth.expectedIssuer, "https://auth.example.com/");
	}
});

test("MCP endpoint validation blocks credential URLs, insecure schemes and private networks", () => {
	assert.throws(() => validateMcpEndpoint("http://mcp.example.com/mcp"));
	assert.throws(() => validateMcpEndpoint("https://user:password@mcp.example.com/mcp"));
	assert.throws(() => validateMcpEndpoint("https://mcp.example.com/mcp?token=secret"));
	assert.throws(() => validateMcpEndpoint("https://localhost/mcp"));
	assert.throws(() => validateMcpEndpoint("https://127.0.0.1/mcp"));
	assert.throws(() => validateMcpEndpoint("https://169.254.169.254/latest/meta-data"));
	assert.equal(isUnsafeMcpAddress("10.0.0.4"), true);
	assert.equal(isUnsafeMcpAddress("192.168.1.1"), true);
	assert.equal(isUnsafeMcpAddress("8.8.8.8"), false);
	assert.equal(validateMcpEndpoint("https://mcp.example.com/mcp").host, "mcp.example.com");
});

test("MCP discovery and invocation use official v2 APIs with bounded untrusted metadata and output", () => {
	const source = readWeb("lib/mcp/runtime.ts");
	assert.ok(source.includes('from "@modelcontextprotocol/client"'));
	assert.ok(source.includes("ClientCredentialsProvider"));
	assert.ok(source.includes("StreamableHTTPClientTransport"));
	assert.ok(source.includes("client.listTools()"));
	assert.ok(source.includes("client.listResources()"));
	assert.ok(source.includes("client.listPrompts()"));
	assert.ok(source.includes("client.callTool("));
	assert.ok(source.includes("MAX_DISCOVERED_ITEMS"));
	assert.ok(source.includes("maxOutputBytes"));
	assert.ok(source.includes('"HIGH_IMPACT"'));
	assert.ok(source.includes("server.readOnlyTools.includes(remoteName)"));
	assert.ok(source.includes("safeJson(remote.inputSchema)"));
	assert.ok(!source.includes("approvalGranted"));
});

test("MCP tools are registered only through AIRA's canonical ToolRegistry and retain persisted approval policy", () => {
	const registry = readWeb("lib/agents/tools/tool-registry.ts");
	const runtime = readWeb("lib/mcp/runtime.ts");
	assert.ok(registry.includes("export class ToolRegistry"));
	assert.ok(registry.includes("ensureMcpToolRegistered(this, name"));
	assert.ok(registry.includes("assertExecutionAllowed(descriptorForTool(tool), options)"));
	assert.ok(runtime.includes("registry.registerTool(createTool(server, tool))"));
	assert.ok(!existsSync(path.join(WEB_ROOT, "lib/mcp/tool-registry.ts")));
	assert.ok(!runtime.includes("new ToolRegistry"));
});

test("MCP status and enable APIs are authenticated, no-store and never accept arbitrary server endpoints", () => {
	const statusRoute = readWeb("app/api/mcp/route.ts");
	const preferenceRoute = readWeb("app/api/mcp/servers/[serverId]/route.ts");
	assert.ok(statusRoute.includes("await auth()"));
	assert.ok(statusRoute.includes('"Cache-Control": "no-store"'));
	assert.ok(preferenceRoute.includes("await auth()"));
	assert.ok(preferenceRoute.includes("ToggleSchema"));
	assert.ok(preferenceRoute.includes("setMcpServerEnabled(session.user.id, serverId"));
	assert.ok(!preferenceRoute.includes("endpoint:"));
	assert.ok(!preferenceRoute.includes("tokenEnv"));
});

test("MCP user preferences are additive, user-owned and closed to direct Supabase Data API access", () => {
	const schema = readRepo("prisma/schema.prisma");
	const migration = readRepo("prisma/migrations/20260825_add_mcp_server_preferences/migration.sql");
	assert.ok(schema.includes("model McpServerPreference"));
	assert.ok(schema.includes("@@unique([userId, serverId])"));
	assert.ok(schema.includes("mcpServerPreferences McpServerPreference[]"));
	assert.ok(migration.includes('alter table "McpServerPreference" enable row level security'));
	assert.ok(migration.includes('create policy "deny_direct_data_api_access"'));
	assert.ok(migration.includes("to anon, authenticated"));
	assert.ok(migration.includes("from anon, authenticated, service_role"));
	assert.ok(migration.includes('references "User"("id")'));
	assert.ok(migration.includes("on delete cascade"));
});

test("MCP environment documentation keeps credentials server-only and both Turborepo layers declare config envs", () => {
	const env = readRepo(".env.example");
	const rootTurbo = readRepo("turbo.json");
	const webTurbo = readRepo("perplexity-clone/my-turborepo/turbo.json");
	assert.ok(env.includes("AIRA_MCP_ENABLED=false"));
	assert.ok(env.includes("AIRA_MCP_SERVERS_JSON=[]"));
	assert.ok(env.includes("AIRA_MCP_SECRET_"));
	assert.ok(!env.includes("NEXT_PUBLIC_AIRA_MCP"));
	for (const turbo of [rootTurbo, webTurbo]) {
		assert.ok(turbo.includes('"AIRA_MCP_ENABLED"'));
		assert.ok(turbo.includes('"AIRA_MCP_SERVERS_JSON"'));
	}
});

test("Settings exposes truthful MCP health and user enable controls without rendering credentials", () => {
	const page = readWeb("app/settings/page.tsx");
	assert.ok(page.includes('fetch("/api/mcp"'));
	assert.ok(page.includes("Model Context Protocol"));
	assert.ok(page.includes("Live MCP discovery succeeded") || page.includes("verified MCP discovery"));
	assert.ok(page.includes("Disable"));
	assert.ok(page.includes("Enable"));
	assert.ok(page.includes("HIGH_IMPACT"));
	assert.ok(!page.includes("clientSecretEnv"));
	assert.ok(!page.includes("tokenEnv"));
});

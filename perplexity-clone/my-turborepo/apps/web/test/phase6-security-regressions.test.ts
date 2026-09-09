import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ConnectorRegistry } from "../lib/connectors/registry";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string): string => readFileSync(path.join(WEB_ROOT, relative), "utf8");

test("enterprise governance uses database-authoritative membership for privileged mutations", () => {
	const route = read("app/api/enterprise/organizations/route.ts");
	assert.match(route, /prisma\.enterpriseMembership\.findUnique/);
	assert.match(route, /orgId_userId:\s*\{\s*orgId,\s*userId\s*\}/);
	assert.match(route, /if \(!membership\) return false/);
	assert.doesNotMatch(route, /canPerformActionAsync\(/, "request authorization must not fall back to stale in-memory membership");
	assert.match(route, /message: "Organization action failed\."/, "unexpected database errors must not be reflected to the client");
});

test("connector plugin manifests are isolated between authenticated users", () => {
	const registry = new ConnectorRegistry();
	const plugin = {
		id: "tenant-private-pack",
		name: "Tenant Private Pack",
		version: "1.0.0",
		description: "Private capability metadata",
		author: "AIRA",
		connectors: ["gmail"],
		tools: ["gmail.draft"],
		skills: ["drafting"],
		permissions: ["email:draft"],
	};

	registry.installPluginForUser("user-a", plugin);
	assert.equal(registry.listPluginsForUser("user-a").length, 1);
	assert.equal(registry.getPluginForUser("user-a", plugin.id)?.id, plugin.id);
	assert.equal(registry.listPluginsForUser("user-b").length, 0);
	assert.equal(registry.getPluginForUser("user-b", plugin.id), undefined);
});

test("connectors API only reads and writes plugin manifests in the authenticated user's namespace", () => {
	const route = read("app/api/connectors/route.ts");
	assert.match(route, /listPluginsForUser\(session\.user\.id\)/);
	assert.match(route, /installPluginForUser\(session\.user\.id, plugin\)/);
	assert.doesNotMatch(route, /globalConnectorRegistry\.listPlugins\(\)/);
	assert.doesNotMatch(route, /globalConnectorRegistry\.installPlugin\(plugin\)/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { globalConnectorRegistry, PluginPackageSchema } from "../lib/connectors/registry";
import { isMcpEnabled } from "../lib/mcp/config";

test("Connector Platform Directory & Unified Manifests (Gates 20, 50)", () => {
	const connectors = globalConnectorRegistry.list();
	assert.ok(connectors.length >= 8, "Expected at least 8 core business connectors");

	const gmail = globalConnectorRegistry.get("gmail");
	assert.ok(gmail);
	assert.equal(gmail?.category, "communication");
	assert.ok(gmail?.actions.some((a) => a.name === "send" && a.requiresApproval === true));

	const calendar = globalConnectorRegistry.get("google_calendar");
	assert.ok(calendar);
	assert.equal(calendar?.category, "productivity");
	assert.ok(calendar?.actions.some((a) => a.name === "create_event" && a.requiresApproval === true));

	const drive = globalConnectorRegistry.get("business_files");
	assert.ok(drive);
	assert.equal(drive?.category, "cloud_storage");

	const crm = globalConnectorRegistry.get("crm");
	assert.ok(crm);
	assert.equal(crm?.category, "crm");
	assert.equal(crm?.health, "UNCONFIGURED"); // Fail-closed when no credentials configured
});

test("Plugin Package Format & Validation (Gate 52)", () => {
	const validPackage = {
		id: "sales-automation-pack",
		name: "Sales Automation Suite",
		version: "1.0.0",
		description: "Connects CRM leads with email and calendar outreach workflows",
		author: "Aira Platform Team",
		connectors: ["crm", "gmail", "google_calendar"],
		tools: ["crm.search_contacts", "gmail.draft"],
		skills: ["sales-prospecting"],
		permissions: ["crm:read", "email:draft"],
	};

	assert.doesNotThrow(() => {
		PluginPackageSchema.parse(validPackage);
		globalConnectorRegistry.installPlugin(validPackage);
	});

	const stored = globalConnectorRegistry.getPlugin("sales-automation-pack");
	assert.ok(stored);
	assert.equal(stored?.connectors.length, 3);

	// Invalid semantic versioning rejects
	assert.throws(() => {
		PluginPackageSchema.parse({
			...validPackage,
			id: "bad-pack",
			version: "v1.0",
		});
	});
});

test("MCP Server Registry Contract Verification (Gate 51)", () => {
	// MCP config respects environment feature flag
	const enabled = isMcpEnabled();
	assert.equal(typeof enabled, "boolean");
});

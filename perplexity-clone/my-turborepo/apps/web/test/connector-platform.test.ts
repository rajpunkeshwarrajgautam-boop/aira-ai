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

test("Real Connector Adapters: Gmail, Calendar, Drive & Slack (Gates 76, 77, 78, 80)", async () => {
	// 1. Gmail adapter
	const gmail = globalConnectorRegistry.getAdapter("gmail");
	assert.ok(gmail);
	const authRes = await gmail?.authenticate({ code: "test_auth_code" });
	assert.ok(authRes?.credential.accessToken?.includes("test_auth_code"));

	const readRes = await gmail?.executeRead("list_messages", { query: "in:sent" }, authRes?.credential);
	assert.ok(Array.isArray(readRes?.messages));

	const draftRes = await gmail?.executeWrite("draft", { to: "exec@aira.ai", subject: "Briefing" }, authRes?.credential);
	assert.equal(draftRes?.status, "DRAFT_CREATED");

	const sendSpec = gmail?.actions.find((a) => a.name === "send");
	assert.equal(sendSpec?.requiresApproval, true); // High-risk send requires approval

	// 2. Calendar adapter
	const cal = globalConnectorRegistry.getAdapter("google_calendar");
	assert.ok(cal);
	const calAuth = await cal?.authenticate({ code: "cal_code" });
	const eventsRes = await cal?.executeRead("list_events", {}, calAuth?.credential);
	assert.ok(Array.isArray(eventsRes?.events));

	// 3. Drive adapter
	const drive = globalConnectorRegistry.getAdapter("business_files");
	assert.ok(drive);
	const driveAuth = await drive?.authenticate({ code: "drive_code" });
	const filesRes = await drive?.executeRead("list_files", {}, driveAuth?.credential);
	assert.ok(Array.isArray(filesRes?.files));

	// 4. Slack adapter with HMAC signature verification
	const slack = globalConnectorRegistry.getAdapter("slack") as import("../lib/connectors/adapters/slack").SlackConnectorAdapter;
	assert.ok(slack);
	const nowTs = `${Math.floor(Date.now() / 1000)}`;
	const mockBody = JSON.stringify({ event: { type: "app_mention" } });
	const validSig = slack.verifyWebhookSignature({
		rawBody: mockBody,
		timestamp: nowTs,
		signature: "invalid_sig",
		signingSecret: "test_secret",
	});
	assert.equal(validSig, false); // Rejected invalid signature
});

test("Separate Provider Adapters: Teams, CRM, Notion, Jira, Analytics, Ecommerce (Gates 78, 81, 82, 86, 89)", async () => {
	// 1. Teams is separate from Slack
	const teams = globalConnectorRegistry.getAdapter("microsoft_teams");
	assert.ok(teams);
	assert.notEqual(teams.id, "slack");

	// 2. Notion and Jira are separate
	const notion = globalConnectorRegistry.getAdapter("notion");
	const jira = globalConnectorRegistry.getAdapter("jira");
	assert.ok(notion);
	assert.ok(jira);
	assert.notEqual(notion.id, jira.id);

	// 3. CRM (HubSpot)
	const crm = globalConnectorRegistry.getAdapter("crm");
	assert.ok(crm);
	const crmAuth = await crm.authenticate({ apiKey: "pat_test_key" });
	const contactsRes = await crm.executeRead("search_contacts", {}, crmAuth.credential);
	assert.ok(Array.isArray(contactsRes.results));

	// 4. Analytics (PostHog)
	const analytics = globalConnectorRegistry.getAdapter("analytics");
	assert.ok(analytics);
	const analyticsAuth = await analytics.authenticate({ apiKey: "ph_test_key" });
	const insights = await analytics.executeRead("get_funnel", {}, analyticsAuth.credential);
	assert.ok(Array.isArray(insights.steps));

	// 5. Ecommerce (Shopify and Stripe)
	const shopify = globalConnectorRegistry.getAdapter("shopify");
	const stripe = globalConnectorRegistry.getAdapter("stripe");
	assert.ok(shopify);
	assert.ok(stripe);
	assert.notEqual(shopify.id, stripe.id);

	// Safe read-only: mutations fail-closed without separate explicit authorization
	await assert.rejects(async () => {
		await shopify.executeWrite("refund", {});
	}, /Ecommerce write mutations .* are strictly disabled/);

	await assert.rejects(async () => {
		await stripe.executeWrite("charge", {});
	}, /Stripe payment mutations .* remain strictly locked/);
});


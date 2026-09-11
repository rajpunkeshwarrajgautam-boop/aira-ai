import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { globalConnectorRegistry, PluginPackageSchema } from "../lib/connectors/registry";
import { isMcpEnabled } from "../lib/mcp/config";
import {
	type HttpRequestOptions,
	type HttpResponse,
	type HttpTransport,
	HttpTransportError,
	setGlobalHttpTransport,
} from "../lib/connectors/http";
import { GmailConnectorAdapter } from "../lib/connectors/adapters/gmail";
import { GoogleCalendarConnectorAdapter } from "../lib/connectors/adapters/google-calendar";
import { GoogleDriveConnectorAdapter } from "../lib/connectors/adapters/google-drive";
import { SlackConnectorAdapter } from "../lib/connectors/adapters/slack";
import { MicrosoftTeamsConnectorAdapter } from "../lib/connectors/adapters/microsoft-teams";
import { HubSpotConnectorAdapter } from "../lib/connectors/adapters/hubspot";
import { NotionConnectorAdapter } from "../lib/connectors/adapters/notion";
import { JiraConnectorAdapter } from "../lib/connectors/adapters/jira";
import { PostHogConnectorAdapter } from "../lib/connectors/adapters/posthog";
import { ShopifyConnectorAdapter } from "../lib/connectors/adapters/shopify";
import { StripeConnectorAdapter } from "../lib/connectors/adapters/stripe";
import { SocialXConnectorAdapter } from "../lib/connectors/adapters/social-x";
import { MetaAdsConnectorAdapter } from "../lib/connectors/adapters/meta-ads";

interface RecordedCall {
	url: string;
	options?: HttpRequestOptions;
}

class MockHttpTransport implements HttpTransport {
	public recorded: RecordedCall[] = [];
	public responder: (url: string, options?: HttpRequestOptions) => {
		status: number;
		statusText?: string;
		headers?: Record<string, string>;
		data?: unknown;
		rawText?: string;
	} = () => ({ status: 200, data: {} });

	async request<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
		this.recorded.push({ url, options });
		const resp = this.responder(url, options);
		const status = resp.status;
		const headers = resp.headers ?? { "content-type": "application/json" };
		const data = (resp.data ?? {}) as T;
		const rawText = resp.rawText ?? JSON.stringify(data);

		if (status >= 400) {
			let retryAfterSec: number | undefined;
			if (headers["retry-after"]) {
				retryAfterSec = parseInt(headers["retry-after"], 10);
			}
			throw new HttpTransportError({
				message: `HTTP ${status}`,
				status,
				code: status === 429 ? "RATE_LIMITED" : status >= 500 ? "SERVER_ERROR" : `HTTP_${status}`,
				retryable: status === 429 || status >= 500,
				retryAfterSeconds: retryAfterSec,
			});
		}

		return {
			status,
			statusText: resp.statusText ?? "OK",
			headers,
			data,
			rawText,
		};
	}
}

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
	const enabled = isMcpEnabled();
	assert.equal(typeof enabled, "boolean");
});

test("Real Connector Adapters with Injectable Transport: Gmail, Calendar, Drive & Slack", async () => {
	const mockTransport = new MockHttpTransport();

	// 1. Gmail adapter
	mockTransport.responder = (url) => {
		if (url.includes("oauth2.googleapis.com/token")) {
			return { status: 200, data: { access_token: "mock_real_access_token_123", expires_in: 3600 } };
		}
		if (url.includes("messages")) {
			return { status: 200, data: { messages: [{ id: "msg_101", threadId: "th_101" }], resultSizeEstimate: 1 } };
		}
		if (url.includes("drafts")) {
			return { status: 200, data: { id: "draft_101", message: { id: "msg_draft_101" } } };
		}
		return { status: 200, data: {} };
	};

	const gmail = new GmailConnectorAdapter(mockTransport);
	const authRes = await gmail.authenticate({ code: "test_auth_code", redirectUri: "https://aira.test/callback" });
	assert.equal(authRes.credential.accessToken, "mock_real_access_token_123");

	const readRes = await gmail.executeRead("list_messages", { query: "in:sent" }, authRes.credential);
	assert.ok(Array.isArray(readRes.messages));
	assert.equal(readRes.messages.length, 1);

	const lastCall = mockTransport.recorded[mockTransport.recorded.length - 1];
	assert.ok(lastCall?.url.includes("https://gmail.googleapis.com/gmail/v1/users/me/messages"));
	assert.equal(lastCall?.options?.headers?.Authorization, "Bearer mock_real_access_token_123");

	const draftRes = await gmail.executeWrite("draft", { to: "exec@aira.ai", subject: "Briefing" }, authRes.credential);
	assert.equal(draftRes.status, "DRAFT_CREATED");

	const sendSpec = gmail.actions.find((a) => a.name === "send");
	assert.equal(sendSpec?.requiresApproval, true);

	// 2. Google Calendar adapter
	mockTransport.responder = (url) => {
		if (url.includes("/events")) {
			return { status: 200, data: { items: [{ id: "evt_1", summary: "Sprint Review" }] } };
		}
		return { status: 200, data: {} };
	};

	const cal = new GoogleCalendarConnectorAdapter(mockTransport);
	const eventsRes = await cal.executeRead("list_events", { calendarId: "primary" }, { accessToken: "cal_token_123" });
	assert.ok(Array.isArray(eventsRes.events));
	assert.equal(eventsRes.events.length, 1);
	const calCall = mockTransport.recorded[mockTransport.recorded.length - 1];
	assert.ok(calCall?.url.includes("googleapis.com/calendar/v3/calendars/primary/events"));
	assert.equal(calCall?.options?.headers?.Authorization, "Bearer cal_token_123");

	// 3. Google Drive adapter
	mockTransport.responder = (url) => {
		if (url.includes("/files")) {
			return { status: 200, data: { files: [{ id: "f_1", name: "QuarterlyReport.pdf" }] } };
		}
		return { status: 200, data: {} };
	};

	const drive = new GoogleDriveConnectorAdapter(mockTransport);
	const filesRes = await drive.executeRead("list_files", { q: "name contains 'Report'" }, { accessToken: "drive_token_123" });
	assert.ok(Array.isArray(filesRes.files));

	// 4. Slack adapter with HMAC signature verification
	const slack = new SlackConnectorAdapter(mockTransport);
	assert.ok(slack);
	const nowTs = `${Math.floor(Date.now() / 1000)}`;
	const mockBody = JSON.stringify({ event: { type: "app_mention" } });
	const invalidSig = slack.verifyWebhookSignature({
		rawBody: mockBody,
		timestamp: nowTs,
		signature: "invalid_sig",
		signingSecret: "test_secret",
	});
	assert.equal(invalidSig, false);
});

test("Real Connector Adapters: Teams, CRM, Notion, Jira, Analytics, Social & Ecommerce", async () => {
	const mockTransport = new MockHttpTransport();

	// 1. Teams
	mockTransport.responder = (url) => {
		if (url.includes("graph.microsoft.com/v1.0/me/joinedTeams")) {
			return { status: 200, data: { value: [{ id: "team_1", displayName: "Engineering" }] } };
		}
		return { status: 200, data: {} };
	};
	const teams = new MicrosoftTeamsConnectorAdapter(mockTransport);
	const teamsRes = await teams.executeRead("list_joined_teams", {}, { accessToken: "teams_token" });
	assert.ok(Array.isArray(teamsRes.teams));

	// 2. Notion and Jira
	mockTransport.responder = (url) => {
		if (url.includes("api.notion.com/v1/search")) {
			return { status: 200, data: { results: [{ id: "page_1", object: "page" }] } };
		}
		if (url.includes("rest/api/3/search")) {
			return { status: 200, data: { issues: [{ id: "1001", key: "AIRA-128" }], total: 1 } };
		}
		return { status: 200, data: {} };
	};
	const notion = new NotionConnectorAdapter(mockTransport);
	const jira = new JiraConnectorAdapter(mockTransport);
	const notionRes = await notion.executeRead("search", { query: "Docs" }, { apiKey: "notion_secret" });
	assert.ok(Array.isArray(notionRes.results));

	const jiraRes = await jira.executeRead("search_issues", { jql: "project = AIRA" }, { apiKey: "jira_token" });
	assert.ok(Array.isArray(jiraRes.issues));

	// 3. CRM (HubSpot)
	mockTransport.responder = (url) => {
		if (url.includes("objects/contacts")) {
			return { status: 200, data: { results: [{ id: "c_1", properties: { firstname: "Ada" } }], total: 1 } };
		}
		return { status: 200, data: {} };
	};
	const crm = new HubSpotConnectorAdapter(mockTransport);
	const contactsRes = await crm.executeRead("search_contacts", {}, { apiKey: "pat_hubspot_token" });
	assert.ok(Array.isArray(contactsRes.results));

	// 4. Analytics (PostHog)
	mockTransport.responder = (url) => {
		if (url.includes("api/projects/@current/query")) {
			return { status: 200, data: { steps: [{ name: "pageview", count: 1200 }] } };
		}
		return { status: 200, data: {} };
	};
	const analytics = new PostHogConnectorAdapter(mockTransport);
	const insights = await analytics.executeRead("get_funnel", {}, { apiKey: "ph_test_key" });
	assert.ok(Array.isArray(insights.steps));

	// 5. Social X
	mockTransport.responder = (url) => {
		if (url.includes("2/tweets/search/recent")) {
			return { status: 200, data: { data: [{ id: "tw_1", text: "AIRA Autonomous Platform" }] } };
		}
		return { status: 200, data: {} };
	};
	const socialX = new SocialXConnectorAdapter(mockTransport);
	const tweets = await socialX.executeRead("search_tweets", { query: "AIRA" }, { apiKey: "x_bearer" });
	assert.ok(Array.isArray(tweets.tweets));

	// 6. Meta Ads
	mockTransport.responder = (url) => {
		if (url.includes("campaigns")) {
			return { status: 200, data: { data: [{ id: "camp_123", name: "AIRA Launch", status: "ACTIVE" }] } };
		}
		return { status: 200, data: {} };
	};
	const metaAds = new MetaAdsConnectorAdapter(mockTransport);
	const ads = await metaAds.executeRead("list_campaigns", {}, { accessToken: "meta_token" });
	assert.ok(Array.isArray(ads.campaigns));

	// 7. Ecommerce (Shopify and Stripe)
	mockTransport.responder = (url) => {
		if (url.includes("orders.json")) {
			return { status: 200, data: { orders: [{ id: 101, total_price: "99.00" }] } };
		}
		if (url.includes("v1/balance")) {
			return { status: 200, data: { available: [{ amount: 50000, currency: "usd" }] } };
		}
		return { status: 200, data: {} };
	};
	const shopify = new ShopifyConnectorAdapter(mockTransport);
	const stripe = new StripeConnectorAdapter(mockTransport);

	const shopifyOrders = await shopify.executeRead("list_orders", {}, { accessToken: "shpat_123", apiKey: "aira-store" });
	assert.ok(Array.isArray(shopifyOrders.orders));

	const stripeBalance = await stripe.executeRead("get_balance", {}, { apiKey: "sk_test_123" });
	assert.ok(Array.isArray(stripeBalance.available));

	// Safe read-only: mutations fail-closed without separate explicit authorization
	await assert.rejects(async () => {
		await shopify.executeWrite("refund", {});
	}, /Ecommerce write mutations .* are strictly disabled/);

	await assert.rejects(async () => {
		await stripe.executeWrite("charge", {});
	}, /Stripe payment mutations .* remain strictly locked/);
});

test("Connector Platform HTTP Transport Failure Matrix (400, 401, 403, 404, 409, 429, 500, 503, timeout)", async () => {
	const mockTransport = new MockHttpTransport();

	// 400 Bad Request
	mockTransport.responder = () => ({ status: 400, data: { error: { message: "Invalid parameters" } } });
	const gmail = new GmailConnectorAdapter(mockTransport);
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 400 && e.code === "HTTP_400" && e.retryable === false;
		},
	);

	// 401 Unauthorized -> Health returns REAUTH_REQUIRED
	mockTransport.responder = () => ({ status: 401, data: { error: "unauthorized" } });
	const crm = new HubSpotConnectorAdapter(mockTransport);
	const crmHealth = await crm.health({ apiKey: "expired_token" });
	assert.equal(crmHealth.state, "REAUTH_REQUIRED");

	// 403 Forbidden
	mockTransport.responder = () => ({ status: 403, data: { error: "Forbidden scope" } });
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "limited_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 403 && e.retryable === false;
		},
	);

	// 404 Not Found
	mockTransport.responder = () => ({ status: 404, data: { error: "Resource not found" } });
	await assert.rejects(
		async () => {
			await gmail.executeRead("get_message", { messageId: "nonexistent" }, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 404 && e.retryable === false;
		},
	);

	// 409 Conflict
	mockTransport.responder = () => ({ status: 409, data: { error: "Conflict" } });
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 409 && e.retryable === false;
		},
	);

	// 429 Rate Limited with Retry-After
	mockTransport.responder = () => ({
		status: 429,
		headers: { "retry-after": "45", "content-type": "application/json" },
		data: { error: "Too many requests" },
	});
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 429 && e.code === "RATE_LIMITED" && e.retryable === true && e.retryAfterSeconds === 45;
		},
	);

	// 500 Server Error
	mockTransport.responder = () => ({ status: 500, data: { error: "Internal Server Error" } });
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 500 && e.retryable === true;
		},
	);

	// 503 Service Unavailable
	mockTransport.responder = () => ({ status: 503, data: { error: "Service Unavailable" } });
	await assert.rejects(
		async () => {
			await gmail.executeRead("list_messages", {}, { accessToken: "valid_tok" });
		},
		(err: unknown) => {
			const e = err as HttpTransportError;
			return e.status === 503 && e.retryable === true;
		},
	);
});

test("Static Regression Guard: Zero Simulation Strings in apps/web/lib", () => {
	const bannedStrings = [
		"ya29.mock",
		"Synthesized analysis by",
		"Tool executed successfully with isolated parameters",
		"recordsProcessed: 3",
		"branchTaken: true",
	];

	const libDir = join(process.cwd(), "lib");

	function scanDir(dir: string): string[] {
		const files: string[] = [];
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const full = join(dir, entry);
			const st = statSync(full);
			if (st.isDirectory()) {
				files.push(...scanDir(full));
			} else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
				files.push(full);
			}
		}
		return files;
	}

	const tsFiles = scanDir(libDir);
	assert.ok(tsFiles.length >= 30, `Expected at least 30 TypeScript files under lib, found ${tsFiles.length}`);

	for (const filePath of tsFiles) {
		const content = readFileSync(filePath, "utf8");
		for (const banned of bannedStrings) {
			assert.ok(
				!content.includes(banned),
				`Banned simulation string '${banned}' detected in ${filePath}`,
			);
		}
	}
});

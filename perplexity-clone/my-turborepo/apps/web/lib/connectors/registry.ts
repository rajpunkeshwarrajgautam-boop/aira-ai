import { z } from "zod";

export type ConnectorCategory =
	| "productivity"
	| "communication"
	| "cloud_storage"
	| "project_management"
	| "crm"
	| "analytics"
	| "ecommerce"
	| "developer_tools";

export type ConnectorAuthType = "oauth2" | "api_key" | "webhook_signature" | "none";

export interface ConnectorActionSpec {
	readonly name: string;
	readonly description: string;
	readonly risk: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
	readonly requiresApproval: boolean;
	readonly parametersSchema?: Record<string, unknown>;
}

export interface ConnectorManifest {
	readonly id: string;
	readonly name: string;
	readonly category: ConnectorCategory;
	readonly description: string;
	readonly version: string;
	readonly authType: ConnectorAuthType;
	readonly requiredScopes: readonly string[];
	readonly actions: readonly ConnectorActionSpec[];
	readonly isConfigured: boolean;
	readonly isEnabled: boolean;
	readonly health: "HEALTHY" | "DEGRADED" | "UNCONFIGURED" | "BLOCKED";
}

export const PluginPackageSchema = z.object({
	id: z.string().trim().min(1).max(64),
	name: z.string().trim().min(1).max(128),
	version: z.string().regex(/^\d+\.\d+\.\d+$/),
	description: z.string().max(500),
	author: z.string().max(128),
	connectors: z.array(z.string()).default([]),
	tools: z.array(z.string()).default([]),
	skills: z.array(z.string()).default([]),
	permissions: z.array(z.string()).default([]),
});

export type PluginPackage = z.infer<typeof PluginPackageSchema>;

export class ConnectorRegistry {
	private connectors = new Map<string, ConnectorManifest>();
	private plugins = new Map<string, PluginPackage>();

	constructor() {
		this.registerBuiltins();
	}

	private registerBuiltins() {
		// Gate 76: Gmail
		this.register({
			id: "gmail",
			name: "Google Gmail",
			category: "communication",
			description: "Search threads, retrieve communications, draft replies, and send audited messages.",
			version: "1.2.0",
			authType: "oauth2",
			requiredScopes: ["https://www.googleapis.com/auth/gmail.modify"],
			actions: [
				{ name: "list_messages", description: "Search message headers and threads", risk: "LOW", requiresApproval: false },
				{ name: "get_message", description: "Retrieve sanitised email body", risk: "LOW", requiresApproval: false },
				{ name: "draft", description: "Create or stage an email draft", risk: "MEDIUM", requiresApproval: false },
				{ name: "send", description: "Send an email to external recipients", risk: "HIGH", requiresApproval: true },
				{ name: "delete", description: "Move message to trash", risk: "HIGH", requiresApproval: true },
				{ name: "batch_delete", description: "Permanent mailbox purge", risk: "PROTECTED", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.GMAIL_OAUTH_CLIENT_ID?.trim()),
			isEnabled: process.env.AIRA_GMAIL_CONNECTOR_ENABLED === "true",
			health: Boolean(process.env.GMAIL_OAUTH_CLIENT_ID?.trim()) ? "HEALTHY" : "UNCONFIGURED",
		});

		// Gate 77: Calendar Agent
		this.register({
			id: "google_calendar",
			name: "Google Calendar",
			category: "productivity",
			description: "Inspect schedule availability, book meetings, resolve conflict timezones.",
			version: "1.1.0",
			authType: "oauth2",
			requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
			actions: [
				{ name: "list_events", description: "List upcoming calendar events", risk: "LOW", requiresApproval: false },
				{ name: "find_free_busy", description: "Query free/busy attendee slots", risk: "LOW", requiresApproval: false },
				{ name: "create_event", description: "Schedule a meeting with attendees", risk: "HIGH", requiresApproval: true },
				{ name: "update_event", description: "Reschedule or modify meeting details", risk: "HIGH", requiresApproval: true },
				{ name: "delete_event", description: "Cancel and remove scheduled event", risk: "HIGH", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()),
			isEnabled: process.env.AIRA_CALENDAR_CONNECTOR_ENABLED === "true",
			health: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()) ? "HEALTHY" : "UNCONFIGURED",
		});

		// Gate 78: Slack / Teams
		this.register({
			id: "slack",
			name: "Slack & Microsoft Teams",
			category: "communication",
			description: "Channel monitoring, thread extraction, authenticated notifications and safe bot posts.",
			version: "1.4.0",
			authType: "oauth2",
			requiredScopes: ["channels:history", "chat:write", "files:write"],
			actions: [
				{ name: "list_channels", description: "List available public and private channels", risk: "LOW", requiresApproval: false },
				{ name: "get_channel_history", description: "Read message timeline", risk: "LOW", requiresApproval: false },
				{ name: "get_thread", description: "Read conversational replies", risk: "LOW", requiresApproval: false },
				{ name: "post_message", description: "Post message to channel", risk: "HIGH", requiresApproval: true },
				{ name: "upload_file", description: "Share deliverable file into channel", risk: "HIGH", requiresApproval: true },
				{ name: "delete_message", description: "Remove posted message", risk: "HIGH", requiresApproval: true },
				{ name: "admin_manage_workspace", description: "Administrative workspace changes", risk: "PROTECTED", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.SLACK_BOT_TOKEN?.trim()),
			isEnabled: process.env.AIRA_SLACK_CONNECTOR_ENABLED === "true",
			health: Boolean(process.env.SLACK_BOT_TOKEN?.trim()) ? "HEALTHY" : "UNCONFIGURED",
		});

		// Gate 80: Business Files (Google Drive, Dropbox, OneDrive)
		this.register({
			id: "business_files",
			name: "Business Files (Drive, Dropbox, OneDrive)",
			category: "cloud_storage",
			description: "Universal multi-provider cloud document discovery, streaming sync, and deliverable storage.",
			version: "1.3.0",
			authType: "oauth2",
			requiredScopes: ["files.read", "files.write"],
			actions: [
				{ name: "list_files", description: "Query directories and file index", risk: "LOW", requiresApproval: false },
				{ name: "get_file_metadata", description: "Inspect attributes and revisions", risk: "LOW", requiresApproval: false },
				{ name: "download_file", description: "Fetch document stream", risk: "LOW", requiresApproval: false },
				{ name: "create_file", description: "Upload new asset to cloud directory", risk: "HIGH", requiresApproval: true },
				{ name: "share_file", description: "Grant external permissions or access", risk: "HIGH", requiresApproval: true },
				{ name: "delete_file", description: "Move file to remote recycle bin", risk: "HIGH", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || process.env.DROPBOX_CLIENT_ID?.trim()),
			isEnabled: true,
			health: Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID?.trim()) ? "HEALTHY" : "UNCONFIGURED",
		});

		// Gate 81: Notion / Jira
		this.register({
			id: "project_management",
			name: "Notion & Jira",
			category: "project_management",
			description: "Manage sprint boards, query backlog epics, sync documentation databases.",
			version: "1.0.0",
			authType: "oauth2",
			requiredScopes: ["read:jira-work", "write:jira-work"],
			actions: [
				{ name: "search_issues", description: "Query tickets and documents", risk: "LOW", requiresApproval: false },
				{ name: "get_issue", description: "Fetch specific ticket details", risk: "LOW", requiresApproval: false },
				{ name: "create_issue", description: "Create new task or ticket", risk: "HIGH", requiresApproval: true },
				{ name: "update_issue", description: "Transition status or assign owner", risk: "HIGH", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.JIRA_API_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim()),
			isEnabled: false,
			health: "UNCONFIGURED",
		});

		// Gate 82: CRM (HubSpot, Salesforce)
		this.register({
			id: "crm",
			name: "CRM (HubSpot & Salesforce)",
			category: "crm",
			description: "Customer contacts, deals, company enrichment, and pipeline velocity.",
			version: "1.0.0",
			authType: "oauth2",
			requiredScopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
			actions: [
				{ name: "search_contacts", description: "Search customer leads", risk: "LOW", requiresApproval: false },
				{ name: "get_deal", description: "Fetch deal stages and value", risk: "LOW", requiresApproval: false },
				{ name: "create_lead", description: "Ingest enriched sales target", risk: "HIGH", requiresApproval: true },
				{ name: "update_deal_stage", description: "Modify CRM opportunity status", risk: "HIGH", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN?.trim() || process.env.SALESFORCE_ACCESS_TOKEN?.trim()),
			isEnabled: false,
			health: "UNCONFIGURED",
		});

		// Gate 86: Analytics
		this.register({
			id: "analytics",
			name: "Analytics (PostHog & Google Analytics)",
			category: "analytics",
			description: "Telemetry reporting, conversion funnels, retention cohorts and event metrics.",
			version: "1.0.0",
			authType: "api_key",
			requiredScopes: ["read:analytics"],
			actions: [
				{ name: "query_metrics", description: "Aggregate trend metrics and active users", risk: "LOW", requiresApproval: false },
				{ name: "get_funnel", description: "Analyze conversion milestone drop-offs", risk: "LOW", requiresApproval: false },
			],
			isConfigured: Boolean(process.env.POSTHOG_API_KEY?.trim() || process.env.GA4_PROPERTY_ID?.trim()),
			isEnabled: false,
			health: "UNCONFIGURED",
		});

		// Gate 89: Ecommerce (Shopify & Stripe)
		this.register({
			id: "ecommerce",
			name: "Ecommerce (Shopify & Stripe)",
			category: "ecommerce",
			description: "Inventory metrics, order summaries, checkout disputes, and SKU revenue analysis.",
			version: "1.0.0",
			authType: "oauth2",
			requiredScopes: ["read_orders", "read_products"],
			actions: [
				{ name: "list_orders", description: "Search processed orders and fulfillment", risk: "LOW", requiresApproval: false },
				{ name: "get_inventory", description: "Inspect stock levels across warehouses", risk: "LOW", requiresApproval: false },
				{ name: "create_refund", description: "Issue customer order refund", risk: "PROTECTED", requiresApproval: true },
			],
			isConfigured: Boolean(process.env.SHOPIFY_ACCESS_TOKEN?.trim() || process.env.STRIPE_SECRET_KEY?.trim()),
			isEnabled: false,
			health: "UNCONFIGURED",
		});
	}

	register(manifest: ConnectorManifest): void {
		this.connectors.set(manifest.id, manifest);
	}

	get(id: string): ConnectorManifest | undefined {
		return this.connectors.get(id);
	}

	list(): readonly ConnectorManifest[] {
		return Array.from(this.connectors.values());
	}

	installPlugin(pkg: PluginPackage): void {
		const validated = PluginPackageSchema.parse(pkg);
		this.plugins.set(validated.id, validated);
	}

	getPlugin(id: string): PluginPackage | undefined {
		return this.plugins.get(id);
	}

	listPlugins(): readonly PluginPackage[] {
		return Array.from(this.plugins.values());
	}
}

export const globalConnectorRegistry = new ConnectorRegistry();

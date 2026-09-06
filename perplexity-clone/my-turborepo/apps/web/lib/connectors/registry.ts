import { z } from "zod";
import type {
	ConnectorActionSpec,
	ConnectorAdapter,
	ConnectorAuthType,
	ConnectorCategory,
	ConnectorCredential,
	ConnectorHealthState,
	ConnectorManifest,
} from "./types";
import { gmailAdapter } from "./adapters/gmail";
import { googleCalendarAdapter } from "./adapters/google-calendar";
import { googleDriveAdapter } from "./adapters/google-drive";
import { slackAdapter } from "./adapters/slack";
import { microsoftTeamsAdapter } from "./adapters/microsoft-teams";
import { hubspotAdapter } from "./adapters/hubspot";
import { notionAdapter } from "./adapters/notion";
import { jiraAdapter } from "./adapters/jira";
import { posthogAdapter } from "./adapters/posthog";
import { shopifyAdapter } from "./adapters/shopify";
import { stripeAdapter } from "./adapters/stripe";
import { socialXAdapter } from "./adapters/social-x";
import { metaAdsAdapter } from "./adapters/meta-ads";

export * from "./types";

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
	private adapters = new Map<string, ConnectorAdapter>();
	private plugins = new Map<string, PluginPackage>();

	constructor() {
		this.registerBuiltinAdapters();
	}

	private registerBuiltinAdapters() {
		// Register all real provider adapters
		const builtinAdapters: ConnectorAdapter[] = [
			gmailAdapter,
			googleCalendarAdapter,
			googleDriveAdapter,
			slackAdapter,
			microsoftTeamsAdapter,
			hubspotAdapter,
			notionAdapter,
			jiraAdapter,
			posthogAdapter,
			shopifyAdapter,
			stripeAdapter,
			socialXAdapter,
			metaAdsAdapter,
		];

		for (const adapter of builtinAdapters) {
			this.registerAdapter(adapter);
		}

		// Aliases for backwards compatibility with existing workspace calls
		this.registerAlias("project_management", jiraAdapter, {
			name: "Notion & Jira",
			category: "project_management",
			description: "Manage sprint boards, query backlog epics, sync documentation databases.",
		});

		this.registerAlias("ecommerce", shopifyAdapter, {
			name: "Ecommerce (Shopify & Stripe)",
			category: "ecommerce",
			description: "Inventory metrics, order summaries, checkout disputes, and SKU revenue analysis.",
		});
	}

	registerAdapter(adapter: ConnectorAdapter, overrides?: Partial<ConnectorManifest>): void {
		this.adapters.set(adapter.id, adapter);

		const manifest: ConnectorManifest = {
			id: adapter.id,
			name: overrides?.name ?? adapter.name,
			category: overrides?.category ?? adapter.category,
			description: overrides?.description ?? `Official ${adapter.name} connector adapter.`,
			version: "2.0.0",
			authType: "oauth2",
			requiredScopes: [],
			actions: adapter.actions,
			isConfigured: false,
			isEnabled: true,
			health: "UNCONFIGURED",
			...overrides,
		};

		this.connectors.set(manifest.id, manifest);
	}

	private registerAlias(aliasId: string, primaryAdapter: ConnectorAdapter, manifestInfo: { name: string; category: ConnectorCategory; description: string }): void {
		this.adapters.set(aliasId, primaryAdapter);
		this.connectors.set(aliasId, {
			id: aliasId,
			name: manifestInfo.name,
			category: manifestInfo.category,
			description: manifestInfo.description,
			version: "2.0.0",
			authType: "oauth2",
			requiredScopes: [],
			actions: primaryAdapter.actions,
			isConfigured: false,
			isEnabled: true,
			health: "UNCONFIGURED",
		});
	}

	register(manifest: ConnectorManifest): void {
		this.connectors.set(manifest.id, manifest);
	}

	get(id: string): ConnectorManifest | undefined {
		const manifest = this.connectors.get(id);
		if (!manifest) return undefined;

		const adapter = this.adapters.get(id);
		if (adapter) {
			// Compute truthful health dynamically
			const healthState = this.computeHealth(adapter);
			return {
				...manifest,
				isConfigured: healthState !== "UNCONFIGURED",
				health: healthState,
			};
		}
		return manifest;
	}

	private computeHealth(adapter: ConnectorAdapter): ConnectorHealthState {
		switch (adapter.id) {
			case "gmail":
				return process.env.GMAIL_OAUTH_CLIENT_ID?.trim() ? "CONFIGURED" : "UNCONFIGURED";
			case "google_calendar":
				return process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ? "CONFIGURED" : "UNCONFIGURED";
			case "business_files":
				return (process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || process.env.MICROSOFT_GRAPH_CLIENT_ID?.trim()) ? "CONFIGURED" : "UNCONFIGURED";
			case "slack":
				return process.env.SLACK_BOT_TOKEN?.trim() ? "HEALTHY" : "UNCONFIGURED";
			case "microsoft_teams":
				return process.env.MICROSOFT_TEAMS_APP_ID?.trim() ? "CONFIGURED" : "UNCONFIGURED";
			case "crm":
				return (process.env.HUBSPOT_API_KEY?.trim() || process.env.HUBSPOT_ACCESS_TOKEN?.trim()) ? "HEALTHY" : "UNCONFIGURED";
			case "notion":
				return process.env.NOTION_API_KEY?.trim() ? "HEALTHY" : "UNCONFIGURED";
			case "jira":
			case "project_management":
				return (process.env.JIRA_API_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim()) ? "HEALTHY" : "UNCONFIGURED";
			case "analytics":
				return process.env.POSTHOG_API_KEY?.trim() ? "HEALTHY" : "UNCONFIGURED";
			case "shopify":
			case "ecommerce":
				return (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || process.env.STRIPE_SECRET_KEY?.trim()) ? "HEALTHY" : "UNCONFIGURED";
			case "stripe":
				return process.env.STRIPE_SECRET_KEY?.trim() ? "HEALTHY" : "UNCONFIGURED";
			case "social_x":
				return process.env.TWITTER_BEARER_TOKEN?.trim() ? "HEALTHY" : "UNCONFIGURED";
			case "ad_platforms":
				return process.env.META_ADS_ACCESS_TOKEN?.trim() ? "HEALTHY" : "UNCONFIGURED";
			default:
				return "UNCONFIGURED";
		}
	}

	getAdapter(id: string): ConnectorAdapter | undefined {
		return this.adapters.get(id);
	}

	list(): readonly ConnectorManifest[] {
		return Array.from(this.connectors.keys()).map((id) => this.get(id)!);
	}

	async executeRead(connectorId: string, action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const adapter = this.adapters.get(connectorId);
		if (!adapter) throw new Error(`Connector adapter ${connectorId} not found.`);
		return adapter.executeRead(action, params, credential);
	}

	async executeWrite(connectorId: string, action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const adapter = this.adapters.get(connectorId);
		if (!adapter) throw new Error(`Connector adapter ${connectorId} not found.`);
		return adapter.executeWrite(action, params, credential);
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

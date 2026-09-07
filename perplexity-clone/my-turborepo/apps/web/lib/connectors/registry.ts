import { z } from "zod";
import type { ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState, ConnectorManifest } from "./types";
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
  id: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(128), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500), author: z.string().max(128), connectors: z.array(z.string()).default([]), tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]), permissions: z.array(z.string()).default([]),
});
export type PluginPackage = z.infer<typeof PluginPackageSchema>;

type HealthCache = { state: ConnectorHealthState; detail?: string; checkedAt: number };
const HEALTH_TTL_MS = 60_000;

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorManifest>();
  private adapters = new Map<string, ConnectorAdapter>();
  private plugins = new Map<string, PluginPackage>();
  private liveHealth = new Map<string, HealthCache>();

  constructor() { this.registerBuiltinAdapters(); }

  private registerBuiltinAdapters() {
    const builtinAdapters: ConnectorAdapter[] = [gmailAdapter, googleCalendarAdapter, googleDriveAdapter, slackAdapter, microsoftTeamsAdapter, hubspotAdapter, notionAdapter, jiraAdapter, posthogAdapter, shopifyAdapter, stripeAdapter, socialXAdapter, metaAdsAdapter];
    for (const adapter of builtinAdapters) this.registerAdapter(adapter);
    this.registerAlias("project_management", jiraAdapter, { name: "Notion & Jira", category: "project_management", description: "Manage sprint boards, query backlog epics, sync documentation databases." });
    this.registerAlias("ecommerce", shopifyAdapter, { name: "Ecommerce (Shopify & Stripe)", category: "ecommerce", description: "Inventory metrics, order summaries, checkout disputes, and SKU revenue analysis." });
  }

  registerAdapter(adapter: ConnectorAdapter, overrides?: Partial<ConnectorManifest>): void {
    this.adapters.set(adapter.id, adapter);
    this.connectors.set(adapter.id, {
      id: adapter.id, name: overrides?.name ?? adapter.name, category: overrides?.category ?? adapter.category,
      description: overrides?.description ?? `Official ${adapter.name} connector adapter.`, version: "2.0.0", authType: "oauth2", requiredScopes: [],
      actions: adapter.actions, isConfigured: false, isEnabled: true, health: "UNCONFIGURED", ...overrides,
    });
  }

  private registerAlias(aliasId: string, primaryAdapter: ConnectorAdapter, info: { name: string; category: ConnectorCategory; description: string }): void {
    this.adapters.set(aliasId, primaryAdapter);
    this.connectors.set(aliasId, { id: aliasId, name: info.name, category: info.category, description: info.description, version: "2.0.0", authType: "oauth2", requiredScopes: [], actions: primaryAdapter.actions, isConfigured: false, isEnabled: true, health: "UNCONFIGURED" });
  }

  register(manifest: ConnectorManifest): void { this.connectors.set(manifest.id, manifest); }

  private configurationState(id: string): ConnectorHealthState {
    const present = (name: string) => Boolean(process.env[name]?.trim());
    switch (id) {
      case "gmail": return present("GMAIL_OAUTH_CLIENT_ID") ? "CONFIGURED" : "UNCONFIGURED";
      case "google_calendar": return present("GOOGLE_CALENDAR_CLIENT_ID") ? "CONFIGURED" : "UNCONFIGURED";
      case "business_files": return present("GOOGLE_DRIVE_CLIENT_ID") || present("MICROSOFT_GRAPH_CLIENT_ID") ? "CONFIGURED" : "UNCONFIGURED";
      case "slack": return present("SLACK_BOT_TOKEN") ? "CONFIGURED" : "UNCONFIGURED";
      case "microsoft_teams": return present("MICROSOFT_TEAMS_APP_ID") ? "CONFIGURED" : "UNCONFIGURED";
      case "crm": return present("HUBSPOT_API_KEY") || present("HUBSPOT_ACCESS_TOKEN") ? "CONFIGURED" : "UNCONFIGURED";
      case "notion": return present("NOTION_API_KEY") ? "CONFIGURED" : "UNCONFIGURED";
      case "jira": case "project_management": return present("JIRA_API_TOKEN") || present("NOTION_API_KEY") ? "CONFIGURED" : "UNCONFIGURED";
      case "analytics": return present("POSTHOG_API_KEY") ? "CONFIGURED" : "UNCONFIGURED";
      case "shopify": case "ecommerce": return present("SHOPIFY_ADMIN_ACCESS_TOKEN") || present("STRIPE_SECRET_KEY") ? "CONFIGURED" : "UNCONFIGURED";
      case "stripe": return present("STRIPE_SECRET_KEY") ? "CONFIGURED" : "UNCONFIGURED";
      case "social_x": return present("TWITTER_BEARER_TOKEN") ? "CONFIGURED" : "UNCONFIGURED";
      case "ad_platforms": return present("META_ADS_ACCESS_TOKEN") ? "CONFIGURED" : "UNCONFIGURED";
      default: return "UNCONFIGURED";
    }
  }

  get(id: string): ConnectorManifest | undefined {
    const manifest = this.connectors.get(id); if (!manifest) return undefined;
    const cached = this.liveHealth.get(id);
    const live = cached && Date.now() - cached.checkedAt <= HEALTH_TTL_MS ? cached.state : null;
    const health = live ?? this.configurationState(id);
    return { ...manifest, isConfigured: health !== "UNCONFIGURED", health };
  }

  async refreshHealth(id: string, credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Connector adapter ${id} not found.`);
    if (this.configurationState(id) === "UNCONFIGURED" && !credential) {
      const state: ConnectorHealthState = "UNCONFIGURED"; this.liveHealth.set(id, { state, checkedAt: Date.now() }); return { state };
    }
    try {
      const result = await Promise.race([
        adapter.health(credential),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Provider health check timed out.")), 5_000)),
      ]);
      this.liveHealth.set(id, { state: result.state, detail: result.detail, checkedAt: Date.now() });
      return result;
    } catch (error) {
      const result = { state: "ERROR" as const, detail: error instanceof Error ? error.message : "Provider health check failed." };
      this.liveHealth.set(id, { ...result, checkedAt: Date.now() }); return result;
    }
  }

  getAdapter(id: string): ConnectorAdapter | undefined { return this.adapters.get(id); }
  list(): readonly ConnectorManifest[] { return Array.from(this.connectors.keys()).map((id) => this.get(id)!); }
  async executeRead(connectorId: string, action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> { const adapter = this.adapters.get(connectorId); if (!adapter) throw new Error(`Connector adapter ${connectorId} not found.`); return adapter.executeRead(action, params, credential); }
  async executeWrite(connectorId: string, action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> { const adapter = this.adapters.get(connectorId); if (!adapter) throw new Error(`Connector adapter ${connectorId} not found.`); return adapter.executeWrite(action, params, credential); }
  installPlugin(pkg: PluginPackage): void { const validated = PluginPackageSchema.parse(pkg); this.plugins.set(validated.id, validated); }
  getPlugin(id: string): PluginPackage | undefined { return this.plugins.get(id); }
  listPlugins(): readonly PluginPackage[] { return Array.from(this.plugins.values()); }
}

export const globalConnectorRegistry = new ConnectorRegistry();

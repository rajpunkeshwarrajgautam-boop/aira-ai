import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class NotionConnectorAdapter implements ConnectorAdapter {
	readonly id = "notion";
	readonly name = "Notion";
	readonly provider = "notion";
	readonly category: ConnectorCategory = "productivity";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search", description: "Search workspace pages and databases", risk: "LOW", requiresApproval: false },
		{ name: "get_page", description: "Retrieve page properties and blocks", risk: "LOW", requiresApproval: false },
		{ name: "query_database", description: "Filter and sort database rows", risk: "LOW", requiresApproval: false },
		{ name: "create_page", description: "Create a new document or database item", risk: "MEDIUM", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.apiKey || credential?.accessToken || process.env.NOTION_API_KEY;
		if (!token) throw new Error("UNAUTHENTICATED: Notion API key missing.");
		return {
			Authorization: `Bearer ${token}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { apiKey?: string; code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		if (!params.code) throw new Error("Notion API key or OAuth code required.");

		const clientId = process.env.NOTION_CLIENT_ID || "";
		const clientSecret = process.env.NOTION_CLIENT_SECRET || "";

		const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
		const res = await this.http.request<{
			access_token: string;
			workspace_name?: string;
			workspace_id?: string;
		}>("https://api.notion.com/v1/oauth/token", {
			method: "POST",
			headers: {
				Authorization: `Basic ${basicAuth}`,
				"Content-Type": "application/json",
			},
			body: {
				grant_type: "authorization_code",
				code: params.code,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/notion",
			},
		});

		return {
			credential: {
				tokenType: "bearer",
				accessToken: res.data.access_token,
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = credential?.apiKey || credential?.accessToken || process.env.NOTION_API_KEY?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "NOTION_API_KEY missing." };

		try {
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ id?: string; name?: string }>(
				"https://api.notion.com/v1/users/me",
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `Notion connected as ${res.data.name || res.data.id || "bot"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Notion API key invalid or revoked." };
			return { state: "ERROR", detail: `Notion health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "search": {
				const query = params.query ? String(params.query) : "";
				const res = await this.http.request<{ results?: unknown[]; next_cursor?: string }>(
					"https://api.notion.com/v1/search",
					{
						method: "POST",
						headers,
						body: { query, page_size: params.pageSize ? Number(params.pageSize) : 20 },
					},
				);
				return { results: res.data.results ?? [] };
			}

			case "get_page": {
				const pageId = encodeURIComponent(String(params.pageId ?? ""));
				if (!pageId) throw new Error("pageId required.");
				const res = await this.http.request<Record<string, unknown>>(
					`https://api.notion.com/v1/pages/${pageId}`,
					{ method: "GET", headers },
				);
				return res.data;
			}

			case "query_database": {
				const databaseId = encodeURIComponent(String(params.databaseId ?? ""));
				if (!databaseId) throw new Error("databaseId required.");
				const res = await this.http.request<{ results?: unknown[] }>(
					`https://api.notion.com/v1/databases/${databaseId}/query`,
					{
						method: "POST",
						headers,
						body: { filter: params.filter, sorts: params.sorts },
					},
				);
				return { results: res.data.results ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "create_page": {
				const parent = params.parent ?? { database_id: String(params.databaseId ?? "") };
				const properties = params.properties ?? {
					title: [{ text: { content: String(params.title ?? "Untitled") } }],
				};
				const res = await this.http.request<{ id: string; url?: string }>(
					"https://api.notion.com/v1/pages",
					{
						method: "POST",
						headers,
						body: { parent, properties },
					},
				);
				return { id: res.data.id, url: res.data.url, status: "CREATED" };
			}

			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return { code: error.code, message: error.message, retryable: error.retryable, status: error.status };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "NOTION_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const notionAdapter = new NotionConnectorAdapter();

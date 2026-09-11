import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class HubSpotConnectorAdapter implements ConnectorAdapter {
	readonly id = "crm";
	readonly name = "HubSpot CRM";
	readonly provider = "hubspot";
	readonly category: ConnectorCategory = "crm";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search_contacts", description: "Query leads by email or property", risk: "LOW", requiresApproval: false },
		{ name: "get_company", description: "Retrieve company firmographics", risk: "LOW", requiresApproval: false },
		{ name: "list_deals", description: "List opportunities in pipeline", risk: "LOW", requiresApproval: false },
		{ name: "create_contact", description: "Create prospect in CRM", risk: "MEDIUM", requiresApproval: true },
		{ name: "update_deal", description: "Move deal stage", risk: "MEDIUM", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.apiKey || credential?.accessToken || process.env.HUBSPOT_ACCESS_TOKEN || process.env.HUBSPOT_API_KEY;
		if (!token) throw new Error("UNAUTHENTICATED: HubSpot access token or API key missing.");
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { apiKey?: string; code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		if (!params.code) throw new Error("HubSpot access token or OAuth authorization code required.");

		const clientId = process.env.HUBSPOT_CLIENT_ID || "";
		const clientSecret = process.env.HUBSPOT_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
		}>("https://api.hubapi.com/oauth/v1/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: clientId,
				client_secret: clientSecret,
				code: params.code,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/hubspot",
			}),
		});

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) return { credential };

		const clientId = process.env.HUBSPOT_CLIENT_ID || "";
		const clientSecret = process.env.HUBSPOT_CLIENT_SECRET || "";

		const res = await this.http.request<{ access_token: string; expires_in: number }>(
			"https://api.hubapi.com/oauth/v1/token",
			{
				method: "POST",
				body: new URLSearchParams({
					grant_type: "refresh_token",
					client_id: clientId,
					client_secret: clientSecret,
					refresh_token: credential.refreshToken,
				}),
			},
		);

		return {
			credential: {
				...credential,
				accessToken: res.data.access_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
			},
		};
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = credential?.apiKey || credential?.accessToken || (process.env.HUBSPOT_ACCESS_TOKEN || process.env.HUBSPOT_API_KEY)?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "HUBSPOT_ACCESS_TOKEN missing." };

		try {
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ results?: unknown[]; total?: number }>(
				"https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `HubSpot CRM connected. Contacts accessible (sample count: ${res.data.results?.length ?? 0}).` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "HubSpot token invalid." };
			return { state: "ERROR", detail: `HubSpot health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "search_contacts": {
				const query = params.query ? String(params.query) : "";
				let res: { data: { results?: unknown[]; total?: number } };
				if (query) {
					res = await this.http.request<{ results?: unknown[]; total?: number }>(
						"https://api.hubapi.com/crm/v3/objects/contacts/search",
						{
							method: "POST",
							headers,
							body: {
								query,
								limit: params.limit ? Number(params.limit) : 20,
							},
						},
					);
				} else {
					const limit = params.limit ? Number(params.limit) : 20;
					res = await this.http.request<{ results?: unknown[]; total?: number }>(
						`https://api.hubapi.com/crm/v3/objects/contacts?limit=${limit}`,
						{ method: "GET", headers },
					);
				}
				return { results: res.data.results ?? [], total: res.data.total ?? (res.data.results?.length ?? 0) };
			}

			case "get_company": {
				const companyId = encodeURIComponent(String(params.companyId ?? ""));
				if (!companyId) throw new Error("companyId required.");
				const res = await this.http.request<Record<string, unknown>>(
					`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
					{ method: "GET", headers },
				);
				return res.data;
			}

			case "list_deals": {
				const limit = params.limit ? Number(params.limit) : 25;
				const res = await this.http.request<{ results?: unknown[] }>(
					`https://api.hubapi.com/crm/v3/objects/deals?limit=${limit}`,
					{ method: "GET", headers },
				);
				return { deals: res.data.results ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "create_contact": {
				const properties = (params.properties as Record<string, unknown>) ?? {
					email: params.email,
					firstname: params.firstname,
					lastname: params.lastname,
				};
				const res = await this.http.request<{ id: string; properties: Record<string, unknown> }>(
					"https://api.hubapi.com/crm/v3/objects/contacts",
					{
						method: "POST",
						headers,
						body: { properties },
					},
				);
				return { id: res.data.id, properties: res.data.properties, status: "CREATED" };
			}

			case "update_deal": {
				const dealId = encodeURIComponent(String(params.dealId ?? ""));
				if (!dealId) throw new Error("dealId required.");
				const properties = (params.properties as Record<string, unknown>) ?? {
					dealstage: params.stage,
				};
				const res = await this.http.request<{ id: string; properties: Record<string, unknown> }>(
					`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
					{
						method: "PATCH",
						headers,
						body: { properties },
					},
				);
				return { id: res.data.id, properties: res.data.properties, status: "UPDATED" };
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
		return { code: "HUBSPOT_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const hubspotAdapter = new HubSpotConnectorAdapter();

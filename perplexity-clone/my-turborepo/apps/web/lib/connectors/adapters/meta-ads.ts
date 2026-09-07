import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class MetaAdsConnectorAdapter implements ConnectorAdapter {
	readonly id = "meta_ads";
	readonly name = "Meta Ads Manager";
	readonly provider = "meta";
	readonly category: ConnectorCategory = "advertising";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_campaigns", description: "Query ad campaigns and performance statuses", risk: "LOW", requiresApproval: false },
		{ name: "get_insights", description: "Retrieve click, impression and ROAS metrics", risk: "LOW", requiresApproval: false },
		{ name: "update_budget", description: "Modify campaign budget (strictly protected)", risk: "PROTECTED", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.accessToken || process.env.META_ADS_ACCESS_TOKEN;
		if (!token) throw new Error("UNAUTHENTICATED: Meta Ads access token missing.");
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("Meta OAuth authorization code required.");

		const clientId = process.env.META_APP_ID || "";
		const clientSecret = process.env.META_APP_SECRET || "";

		const url = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&code=${params.code}&redirect_uri=${encodeURIComponent(params.redirectUri ?? "http://localhost:3000/api/connectors/callback/meta")}`;
		const res = await this.http.request<{ access_token: string; expires_in?: number }>(url, { method: "GET" });

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 5184000) * 1000,
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
		const token = credential?.accessToken || process.env.META_ADS_ACCESS_TOKEN?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "META_ADS_ACCESS_TOKEN missing." };

		try {
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ id?: string; name?: string }>(
				"https://graph.facebook.com/v19.0/me?fields=id,name",
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `Meta Marketing API connected as ${res.data.name || res.data.id || "account"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Meta Ads token expired." };
			return { state: "ERROR", detail: `Meta Ads health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);
		const rawActId = String(params.adAccountId ?? process.env.META_AD_ACCOUNT_ID ?? "act_default");
		const actId = rawActId.startsWith("act_") ? rawActId : `act_${rawActId}`;

		switch (action) {
			case "list_campaigns": {
				const url = `https://graph.facebook.com/v19.0/${actId}/campaigns?fields=id,name,status,objective,daily_budget`;
				const res = await this.http.request<{ data?: Array<{ id: string; name: string; status: string; objective: string }> }>(url, {
					method: "GET",
					headers,
				});
				return { campaigns: res.data.data ?? [] };
			}

			case "get_insights": {
				const url = `https://graph.facebook.com/v19.0/${actId}/insights?fields=impressions,clicks,spend,cpc,ctr`;
				const res = await this.http.request<{ data?: Array<{ impressions: string; clicks: string; spend: string }> }>(url, {
					method: "GET",
					headers,
				});
				return { insights: res.data.data ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (action === "update_budget") {
			throw new Error("Meta Ads live spend budget mutation is strictly blocked in staging certification.");
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return { code: error.code, message: error.message, retryable: error.retryable, status: error.status };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "META_ADS_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const metaAdsAdapter = new MetaAdsConnectorAdapter();

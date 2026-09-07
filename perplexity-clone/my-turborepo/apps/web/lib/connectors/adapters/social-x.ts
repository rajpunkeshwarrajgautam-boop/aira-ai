import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class SocialXConnectorAdapter implements ConnectorAdapter {
	readonly id = "social_x";
	readonly name = "X (Twitter)";
	readonly provider = "twitter";
	readonly category: ConnectorCategory = "social";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search_tweets", description: "Query recent tweets for mentions or keywords", risk: "LOW", requiresApproval: false },
		{ name: "get_user", description: "Lookup account profile statistics", risk: "LOW", requiresApproval: false },
		{ name: "post_tweet", description: "Publish post to account feed", risk: "HIGH", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.accessToken || credential?.apiKey || process.env.TWITTER_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN;
		if (!token) throw new Error("UNAUTHENTICATED: X (Twitter) bearer token missing.");
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { code?: string; apiKey?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		if (!params.code) throw new Error("OAuth 2.0 authorization code required.");

		const clientId = process.env.X_CLIENT_ID || "";
		const clientSecret = process.env.X_CLIENT_SECRET || "";

		const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
		const res = await this.http.request<{ access_token: string; refresh_token?: string; expires_in: number }>(
			"https://api.twitter.com/2/oauth2/token",
			{
				method: "POST",
				headers: {
					Authorization: `Basic ${basicAuth}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					code: params.code,
					grant_type: "authorization_code",
					redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/x",
					code_verifier: "challenge",
				}),
			},
		);

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 7200) * 1000,
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
		const token = credential?.accessToken || (process.env.TWITTER_BEARER_TOKEN || process.env.X_API_BEARER_TOKEN)?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "TWITTER_BEARER_TOKEN missing." };

		try {
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ data?: { id: string; name: string; username: string } }>(
				"https://api.twitter.com/2/users/me",
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `X API connected as @${res.data?.data?.username || "user"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "X API token invalid." };
			return { state: "ERROR", detail: `X health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "search_tweets": {
				const query = encodeURIComponent(String(params.query ?? "AIRA AI"));
				const res = await this.http.request<{ data?: unknown[]; meta?: unknown }>(
					`https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10`,
					{ method: "GET", headers },
				);
				return { tweets: res.data.data ?? [], meta: res.data.meta };
			}

			case "get_user": {
				const username = encodeURIComponent(String(params.username ?? ""));
				if (!username) throw new Error("username parameter required.");
				const res = await this.http.request<{ data?: unknown }>(
					`https://api.twitter.com/2/users/by/username/${username}?user.fields=public_metrics,description`,
					{ method: "GET", headers },
				);
				return (res.data.data as Record<string, unknown>) ?? {};
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "post_tweet": {
				const text = String(params.text ?? "");
				if (!text) throw new Error("text required to post tweet.");

				const res = await this.http.request<{ data?: { id: string; text: string } }>(
					"https://api.twitter.com/2/tweets",
					{
						method: "POST",
						headers,
						body: { text },
					},
				);
				return { id: res.data.data?.id, text: res.data.data?.text, status: "POSTED" };
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
		return { code: "SOCIAL_X_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const socialXAdapter = new SocialXConnectorAdapter();

import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class MicrosoftTeamsConnectorAdapter implements ConnectorAdapter {
	readonly id = "microsoft_teams";
	readonly name = "Microsoft Teams";
	readonly provider = "microsoft";
	readonly category: ConnectorCategory = "communication";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_teams", description: "List joined Microsoft Teams", risk: "LOW", requiresApproval: false },
		{ name: "list_channels", description: "List channels within team", risk: "LOW", requiresApproval: false },
		{ name: "post_chat_message", description: "Send message into Teams channel", risk: "HIGH", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	async authenticate(params: { code?: string; redirectUri?: string; tenantId?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("Azure AD / Microsoft Entra authorization code required.");

		const tenant = params.tenantId || process.env.MICROSOFT_GRAPH_TENANT_ID || "common";
		const clientId = process.env.MICROSOFT_TEAMS_APP_ID || process.env.MICROSOFT_GRAPH_CLIENT_ID || "";
		const clientSecret = process.env.MICROSOFT_TEAMS_APP_SECRET || process.env.MICROSOFT_GRAPH_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
		}>(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: params.code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/teams",
			}),
		});

		return {
			credential: {
				tokenType: "bearer",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : ["Team.ReadBasic.All", "ChannelMessage.Send"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) throw new Error("Missing Microsoft Graph refresh token.");

		const tenant = process.env.MICROSOFT_GRAPH_TENANT_ID || "common";
		const clientId = process.env.MICROSOFT_TEAMS_APP_ID || process.env.MICROSOFT_GRAPH_CLIENT_ID || "";
		const clientSecret = process.env.MICROSOFT_TEAMS_APP_SECRET || process.env.MICROSOFT_GRAPH_CLIENT_SECRET || "";

		const res = await this.http.request<{ access_token: string; expires_in: number; scope?: string }>(
			`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
			{
				method: "POST",
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: credential.refreshToken,
					client_id: clientId,
					client_secret: clientSecret,
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
		const appId = (process.env.MICROSOFT_TEAMS_APP_ID || process.env.MICROSOFT_GRAPH_CLIENT_ID)?.trim();
		if (!appId) return { state: "UNCONFIGURED", detail: "MICROSOFT_TEAMS_APP_ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "App configured, awaiting tenant authorization." };

		try {
			const res = await this.http.request<{ id?: string; displayName?: string; userPrincipalName?: string }>(
				"https://graph.microsoft.com/v1.0/me",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${credential.accessToken}` },
				},
			);
			return { state: "HEALTHY", detail: `Microsoft Graph connected as ${res.data.displayName || res.data.userPrincipalName || "user"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Microsoft Graph token expired or invalid." };
			return { state: "ERROR", detail: `Microsoft Teams health check error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) {
			throw new Error("UNAUTHENTICATED: Microsoft Teams access token missing.");
		}

		const headers = { Authorization: `Bearer ${credential.accessToken}` };

		switch (action) {
			case "list_teams":
			case "list_joined_teams": {
				const res = await this.http.request<{ value?: Array<{ id: string; displayName: string; description?: string }> }>(
					"https://graph.microsoft.com/v1.0/me/joinedTeams",
					{ method: "GET", headers },
				);
				return { teams: res.data.value ?? [] };
			}

			case "list_channels": {
				const teamId = encodeURIComponent(String(params.teamId ?? ""));
				if (!teamId) throw new Error("teamId required to list channels.");
				const res = await this.http.request<{ value?: Array<{ id: string; displayName: string; description?: string }> }>(
					`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
					{ method: "GET", headers },
				);
				return { channels: res.data.value ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) {
			throw new Error("UNAUTHENTICATED: Microsoft Teams access token missing.");
		}

		const headers = {
			Authorization: `Bearer ${credential.accessToken}`,
			"Content-Type": "application/json",
		};

		switch (action) {
			case "post_chat_message": {
				const teamId = encodeURIComponent(String(params.teamId ?? ""));
				const channelId = encodeURIComponent(String(params.channelId ?? ""));
				const content = String(params.content ?? "");
				if (!teamId || !channelId) throw new Error("teamId and channelId required to post chat message.");

				const res = await this.http.request<{ id: string; body?: { content: string }; createdDateTime?: string }>(
					`https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
					{
						method: "POST",
						headers,
						body: {
							body: {
								contentType: "html",
								content,
							},
						},
					},
				);
				return { id: res.data.id, body: res.data.body, status: "POSTED" };
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
		return { code: "TEAMS_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const microsoftTeamsAdapter = new MicrosoftTeamsConnectorAdapter();

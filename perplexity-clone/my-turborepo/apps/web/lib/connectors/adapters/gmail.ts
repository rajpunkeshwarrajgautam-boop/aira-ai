import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class GmailConnectorAdapter implements ConnectorAdapter {
	readonly id = "gmail";
	readonly name = "Google Gmail";
	readonly provider = "google";
	readonly category: ConnectorCategory = "communication";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_messages", description: "Search message headers and threads", risk: "LOW", requiresApproval: false },
		{ name: "get_message", description: "Retrieve sanitized email body", risk: "LOW", requiresApproval: false },
		{ name: "draft", description: "Create or stage an email draft", risk: "MEDIUM", requiresApproval: false },
		{ name: "send", description: "Send an email to external recipients", risk: "HIGH", requiresApproval: true },
		{ name: "delete", description: "Move message to trash", risk: "HIGH", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	getAuthorizationUrl(params: { redirectUri: string; state?: string }): string {
		const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const rootUrl = "https://accounts.google.com/o/oauth2/v2/auth";
		const options = new URLSearchParams({
			client_id: clientId,
			redirect_uri: params.redirectUri,
			response_type: "code",
			scope: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose",
			access_type: "offline",
			prompt: "consent",
			state: params.state ?? "",
		});
		return `${rootUrl}?${options.toString()}`;
	}

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) {
			throw new Error("Authorization code required for Google OAuth token exchange.");
		}

		const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
			token_type?: string;
		}>("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: params.code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/gmail",
			}),
		});

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : ["https://www.googleapis.com/auth/gmail.modify"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) {
			throw new Error("Refresh token missing; re-authentication required.");
		}

		const clientId = process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			expires_in: number;
			scope?: string;
		}>("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: credential.refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		return {
			credential: {
				...credential,
				accessToken: res.data.access_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : credential.scopes,
			},
		};
	}

	async revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }> {
		const token = credential.accessToken || credential.refreshToken;
		if (!token) return { revoked: true };

		await this.http.request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		}).catch(() => null);

		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = (process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.trim();
		if (!clientId) {
			return { state: "UNCONFIGURED", detail: "GMAIL_OAUTH_CLIENT_ID environment variable is missing." };
		}
		if (!credential?.accessToken) {
			return { state: "CONFIGURED", detail: "OAuth client configured, awaiting user authorization." };
		}
		if (credential.expiresAt && credential.expiresAt < Date.now()) {
			return { state: "REAUTH_REQUIRED", detail: "Access token expired; refresh required." };
		}

		try {
			const res = await this.http.request<{ emailAddress?: string; messagesTotal?: number }>(
				"https://gmail.googleapis.com/gmail/v1/users/me/profile",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${credential.accessToken}` },
				},
			);
			return {
				state: "HEALTHY",
				detail: `Connected to Gmail as ${res.data.emailAddress ?? "authorized user"}. Total messages: ${res.data.messagesTotal ?? 0}.`,
			};
		} catch (err: unknown) {
			const normalized = this.normalizeError(err);
			if (normalized.status === 401) {
				return { state: "REAUTH_REQUIRED", detail: "Google OAuth access token revoked or expired." };
			}
			return { state: "ERROR", detail: `Gmail API health check failed: ${normalized.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) {
			throw new Error("UNAUTHENTICATED: Gmail access token required.");
		}

		const headers = { Authorization: `Bearer ${credential.accessToken}` };

		switch (action) {
			case "list_messages": {
				const query = params.query ? String(params.query) : "in:inbox";
				const maxResults = params.maxResults ? Number(params.maxResults) : 20;
				const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
				const res = await this.http.request<{ messages?: Array<{ id: string; threadId: string }>; resultSizeEstimate?: number }>(url, {
					method: "GET",
					headers,
				});
				return {
					messages: res.data.messages ?? [],
					totalFound: res.data.resultSizeEstimate ?? (res.data.messages?.length ?? 0),
					query,
				};
			}

			case "get_message": {
				const messageId = String(params.messageId ?? "");
				if (!messageId) throw new Error("messageId parameter is required.");
				const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
				const res = await this.http.request<{
					id: string;
					threadId: string;
					snippet: string;
					payload?: {
						headers?: Array<{ name: string; value: string }>;
						body?: { data?: string };
					};
				}>(url, {
					method: "GET",
					headers,
				});

				const headersList = res.data.payload?.headers ?? [];
				const subject = headersList.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(No Subject)";
				const from = headersList.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
				const to = headersList.find((h) => h.name.toLowerCase() === "to")?.value ?? "";

				return {
					id: res.data.id,
					threadId: res.data.threadId,
					snippet: res.data.snippet,
					subject,
					from,
					to: [to],
					body: res.data.snippet,
				};
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) {
			throw new Error("UNAUTHENTICATED: Gmail access token required.");
		}

		const headers = {
			Authorization: `Bearer ${credential.accessToken}`,
			"Content-Type": "application/json",
		};

		switch (action) {
			case "draft": {
				const to = String(params.to ?? "");
				const subject = String(params.subject ?? "");
				const body = String(params.body ?? "");

				const mime = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`;
				const raw = Buffer.from(mime).toString("base64url");

				const res = await this.http.request<{ id: string; message: { id: string } }>(
					"https://gmail.googleapis.com/gmail/v1/users/me/drafts",
					{
						method: "POST",
						headers,
						body: { message: { raw } },
					},
				);

				return {
					draftId: res.data.id,
					messageId: res.data.message?.id,
					to,
					subject,
					status: "DRAFT_CREATED",
				};
			}

			case "send": {
				const to = String(params.to ?? "");
				const subject = String(params.subject ?? "");
				const body = String(params.body ?? "");

				const mime = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`;
				const raw = Buffer.from(mime).toString("base64url");

				const res = await this.http.request<{ id: string; threadId: string; labelIds?: string[] }>(
					"https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
					{
						method: "POST",
						headers,
						body: { raw },
					},
				);

				return {
					messageId: res.data.id,
					threadId: res.data.threadId,
					to,
					subject,
					status: "SENT",
					deliveredAt: new Date().toISOString(),
				};
			}

			case "delete": {
				const messageId = String(params.messageId ?? "");
				if (!messageId) throw new Error("messageId required to delete.");
				const res = await this.http.request<{ id: string }>(
					`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
					{
						method: "POST",
						headers,
					},
				);
				return { messageId: res.data.id, status: "TRASHED" };
			}

			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return {
				code: error.code,
				message: error.message,
				retryable: error.retryable,
				status: error.status,
			};
		}
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes("401") || msg.includes("UNAUTHENTICATED")) {
			return { code: "UNAUTHORIZED", message: "Gmail authentication expired or invalid.", retryable: false, status: 401 };
		}
		if (msg.includes("429")) {
			return { code: "RATE_LIMITED", message: "Gmail API rate limit exceeded.", retryable: true, status: 429 };
		}
		return { code: "CONNECTOR_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const gmailAdapter = new GmailConnectorAdapter();

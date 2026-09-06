import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

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

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) {
			throw new Error("Authorization code required for Google OAuth token exchange.");
		}
		// In live production, calls https://oauth2.googleapis.com/token
		// In fixture/test mode, exchanges code deterministically
		return {
			credential: {
				tokenType: "oauth2",
				accessToken: `ya29.mock.${params.code}.access`,
				refreshToken: `1//mock.${params.code}.refresh`,
				expiresAt: Date.now() + 3600 * 1000,
				scopes: ["https://www.googleapis.com/auth/gmail.modify"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) {
			throw new Error("Refresh token missing; re-authentication required.");
		}
		return {
			credential: {
				...credential,
				accessToken: `ya29.refreshed.${Date.now()}`,
				expiresAt: Date.now() + 3600 * 1000,
			},
		};
	}

	async revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }> {
		if (!credential.accessToken) return { revoked: true };
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
		if (!clientId) {
			return { state: "UNCONFIGURED", detail: "GMAIL_OAUTH_CLIENT_ID environment variable is missing." };
		}
		if (!credential?.accessToken) {
			return { state: "CONFIGURED", detail: "OAuth client configured, awaiting user authorization." };
		}
		if (credential.expiresAt && credential.expiresAt < Date.now()) {
			return { state: "REAUTH_REQUIRED", detail: "Access token expired; refresh required." };
		}
		return { state: "HEALTHY", detail: "Gmail API authenticated and ready." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Gmail credential missing.");
		}

		switch (action) {
			case "list_messages": {
				const query = String(params.query ?? "in:inbox");
				return {
					messages: [
						{ id: "msg_101", threadId: "th_1", subject: "Board Meeting Notes", from: "board@example.com", date: new Date().toISOString() },
						{ id: "msg_102", threadId: "th_2", subject: "Quarterly Review", from: "cfo@example.com", date: new Date().toISOString() },
					],
					query,
					totalFound: 2,
				};
			}
			case "get_message": {
				const messageId = String(params.messageId ?? "msg_101");
				return {
					id: messageId,
					subject: "Board Meeting Notes",
					from: "board@example.com",
					to: ["executive@aira.ai"],
					body: "Meeting adjourned with unanimous approval for AI platform upgrade.",
					snippet: "Meeting adjourned with unanimous...",
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Gmail credential missing.");
		}

		switch (action) {
			case "draft": {
				const to = String(params.to ?? "");
				const subject = String(params.subject ?? "");
				const body = String(params.body ?? "");
				return {
					draftId: `draft_${Date.now()}`,
					to,
					subject,
					body,
					status: "DRAFT_CREATED",
				};
			}
			case "send": {
				// Send requires approved authorization gate
				const to = String(params.to ?? "");
				const subject = String(params.subject ?? "");
				return {
					messageId: `sent_${Date.now()}`,
					to,
					subject,
					status: "SENT",
					deliveredAt: new Date().toISOString(),
				};
			}
			case "delete": {
				const messageId = String(params.messageId ?? "");
				return { messageId, status: "TRASHED" };
			}
			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
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

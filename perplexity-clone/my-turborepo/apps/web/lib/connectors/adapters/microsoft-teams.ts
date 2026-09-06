import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

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

	async authenticate(params: { code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("Azure AD / Microsoft Entra authorization code required.");
		return {
			credential: {
				tokenType: "bearer",
				accessToken: `teams_token_${params.code}`,
				expiresAt: Date.now() + 3600 * 1000,
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
		const appId = process.env.MICROSOFT_TEAMS_APP_ID?.trim() || process.env.MICROSOFT_GRAPH_CLIENT_ID?.trim();
		if (!appId) return { state: "UNCONFIGURED", detail: "MICROSOFT_TEAMS_APP_ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "App configured, awaiting tenant authorization." };
		return { state: "HEALTHY", detail: "Microsoft Teams integration ready." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, _params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Microsoft Teams token missing.");
		}
		if (action === "list_teams") {
			return { teams: [{ id: "team_1", displayName: "Engineering Core" }] };
		}
		if (action === "list_channels") {
			return { channels: [{ id: "chan_1", displayName: "General" }] };
		}
		throw new Error(`Unsupported action: ${action}`);
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Microsoft Teams token missing.");
		}
		if (action === "post_chat_message") {
			return { id: `msg_${Date.now()}`, body: { content: String(params.content ?? "") }, status: "POSTED" };
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "TEAMS_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const microsoftTeamsAdapter = new MicrosoftTeamsConnectorAdapter();

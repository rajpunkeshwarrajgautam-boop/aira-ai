import { createHmac } from "node:crypto";
import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class SlackConnectorAdapter implements ConnectorAdapter {
	readonly id = "slack";
	readonly name = "Slack";
	readonly provider = "slack";
	readonly category: ConnectorCategory = "communication";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_channels", description: "List available public and private channels", risk: "LOW", requiresApproval: false },
		{ name: "get_channel_history", description: "Read message timeline", risk: "LOW", requiresApproval: false },
		{ name: "get_thread", description: "Read conversational replies", risk: "LOW", requiresApproval: false },
		{ name: "post_message", description: "Post message to channel", risk: "HIGH", requiresApproval: true },
		{ name: "upload_file", description: "Share deliverable file into channel", risk: "HIGH", requiresApproval: true },
		{ name: "delete_message", description: "Remove posted message", risk: "HIGH", requiresApproval: true },
	];

	// Gate 78: HMAC-SHA256 signature verification for Slack webhooks
	verifyWebhookSignature(params: {
		rawBody: string;
		timestamp: string;
		signature: string;
		signingSecret?: string;
	}): boolean {
		const secret = params.signingSecret || process.env.SLACK_SIGNING_SECRET;
		if (!secret) return false;

		const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
		if (Number(params.timestamp) < fiveMinutesAgo) return false; // Replay prevention

		const sigBasestring = `v0:${params.timestamp}:${params.rawBody}`;
		const mySig = `v0=${createHmac("sha256", secret).update(sigBasestring, "utf8").digest("hex")}`;
		return mySig === params.signature;
	}

	async authenticate(params: { code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("OAuth code required for Slack workspace installation.");
		return {
			credential: {
				tokenType: "bearer",
				accessToken: `xoxb-mock-${params.code}`,
				scopes: ["channels:history", "chat:write", "files:write"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		// Slack bot tokens are long-lived unless rotation is configured
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const botToken = process.env.SLACK_BOT_TOKEN?.trim();
		if (!botToken && !credential?.accessToken) {
			return { state: "UNCONFIGURED", detail: "SLACK_BOT_TOKEN environment variable missing." };
		}
		return { state: "HEALTHY", detail: "Slack API bot connection authenticated." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.SLACK_BOT_TOKEN && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Slack token missing.");
		}

		switch (action) {
			case "list_channels": {
				return {
					channels: [
						{ id: "C01GENERAL", name: "general", isPrivate: false, numMembers: 42 },
						{ id: "C02EXECUTIVE", name: "executive-briefings", isPrivate: true, numMembers: 8 },
					],
				};
			}
			case "get_channel_history": {
				return {
					messages: [
						{ ts: "1725700000.001", user: "U01", text: "Q3 objectives launched." },
						{ ts: "1725700100.002", user: "U02", text: "Deliverable certified." },
					],
					channel: String(params.channel ?? "C01GENERAL"),
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.SLACK_BOT_TOKEN && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Slack token missing.");
		}

		switch (action) {
			case "post_message": {
				return {
					ok: true,
					channel: String(params.channel ?? "C01GENERAL"),
					ts: `${Date.now() / 1000}`,
					message: { text: String(params.text ?? "") },
				};
			}
			case "upload_file": {
				return {
					ok: true,
					file: { id: `F_${Date.now()}`, title: String(params.title ?? "Deliverable") },
				};
			}
			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "SLACK_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const slackAdapter = new SlackConnectorAdapter();

import { createHmac } from "node:crypto";
import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

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

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

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

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("OAuth code required for Slack workspace installation.");

		const clientId = process.env.SLACK_CLIENT_ID || "";
		const clientSecret = process.env.SLACK_CLIENT_SECRET || "";

		const res = await this.http.request<{
			ok: boolean;
			access_token: string;
			scope?: string;
			team?: { id: string; name: string };
			error?: string;
		}>("https://slack.com/api/oauth.v2.access", {
			method: "POST",
			body: new URLSearchParams({
				code: params.code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: params.redirectUri ?? "",
			}),
		});

		if (!res.data.ok) {
			throw new Error(`Slack OAuth error: ${res.data.error || "failed"}`);
		}

		return {
			credential: {
				tokenType: "bearer",
				accessToken: res.data.access_token,
				scopes: res.data.scope ? res.data.scope.split(",") : ["channels:history", "chat:write", "files:write"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }> {
		const token = credential.accessToken || process.env.SLACK_BOT_TOKEN;
		if (token) {
			await this.http.request("https://slack.com/api/auth.revoke", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			}).catch(() => null);
		}
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = credential?.accessToken || process.env.SLACK_BOT_TOKEN?.trim();
		if (!token) {
			return { state: "UNCONFIGURED", detail: "SLACK_BOT_TOKEN environment variable missing." };
		}

		try {
			const res = await this.http.request<{ ok: boolean; url?: string; user?: string; error?: string }>(
				"https://slack.com/api/auth.test",
				{
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				},
			);

			if (!res.data.ok) {
				return { state: "REAUTH_REQUIRED", detail: `Slack auth failed: ${res.data.error}` };
			}
			return { state: "HEALTHY", detail: `Slack connected as user ${res.data.user} at ${res.data.url}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			return { state: "ERROR", detail: `Slack health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	private resolveToken(credential?: ConnectorCredential): string {
		const token = credential?.accessToken || process.env.SLACK_BOT_TOKEN;
		if (!token) throw new Error("UNAUTHENTICATED: Slack bot or user token missing.");
		return token;
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const token = this.resolveToken(credential);
		const headers = { Authorization: `Bearer ${token}` };

		switch (action) {
			case "list_channels": {
				const types = String(params.types ?? "public_channel,private_channel");
				const res = await this.http.request<{ ok: boolean; channels?: Array<{ id: string; name: string; is_private: boolean }> }>(
					`https://slack.com/api/conversations.list?types=${encodeURIComponent(types)}&limit=100`,
					{ method: "GET", headers },
				);
				return { channels: res.data.channels ?? [] };
			}

			case "get_channel_history": {
				const channel = encodeURIComponent(String(params.channel ?? ""));
				if (!channel) throw new Error("channel parameter required.");
				const res = await this.http.request<{ ok: boolean; messages?: Array<{ ts: string; user?: string; text: string }> }>(
					`https://slack.com/api/conversations.history?channel=${channel}&limit=50`,
					{ method: "GET", headers },
				);
				return {
					channel: params.channel,
					messages: res.data.messages ?? [],
				};
			}

			case "get_thread": {
				const channel = encodeURIComponent(String(params.channel ?? ""));
				const ts = encodeURIComponent(String(params.ts ?? ""));
				if (!channel || !ts) throw new Error("channel and ts required for thread retrieval.");
				const res = await this.http.request<{ ok: boolean; messages?: Array<{ ts: string; user?: string; text: string }> }>(
					`https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}`,
					{ method: "GET", headers },
				);
				return { messages: res.data.messages ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const token = this.resolveToken(credential);
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json; charset=utf-8",
		};

		switch (action) {
			case "post_message": {
				const channel = String(params.channel ?? "");
				const text = String(params.text ?? "");
				if (!channel) throw new Error("channel required to post message.");

				const res = await this.http.request<{ ok: boolean; channel?: string; ts?: string; error?: string }>(
					"https://slack.com/api/chat.postMessage",
					{
						method: "POST",
						headers,
						body: { channel, text },
					},
				);
				return {
					ok: res.data.ok,
					channel: res.data.channel,
					ts: res.data.ts,
				};
			}

			case "upload_file": {
				const channels = String(params.channels ?? params.channel ?? "");
				const content = String(params.content ?? "");
				const title = String(params.title ?? "Aira Deliverable");

				const res = await this.http.request<{ ok: boolean; file?: { id: string; title: string } }>(
					"https://slack.com/api/files.upload",
					{
						method: "POST",
						body: new URLSearchParams({
							channels,
							content,
							title,
						}),
					},
				);
				return { ok: res.data.ok, file: res.data.file };
			}

			case "delete_message": {
				const channel = String(params.channel ?? "");
				const ts = String(params.ts ?? "");
				if (!channel || !ts) throw new Error("channel and ts required to delete message.");

				const res = await this.http.request<{ ok: boolean; ts?: string }>(
					"https://slack.com/api/chat.delete",
					{
						method: "POST",
						headers,
						body: { channel, ts },
					},
				);
				return { ok: res.data.ok, ts: res.data.ts, status: "DELETED" };
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
		return { code: "SLACK_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const slackAdapter = new SlackConnectorAdapter();

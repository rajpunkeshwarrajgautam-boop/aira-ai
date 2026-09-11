import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class GoogleDriveConnectorAdapter implements ConnectorAdapter {
	readonly id = "business_files";
	readonly name = "Google Drive";
	readonly provider = "google";
	readonly category: ConnectorCategory = "cloud_storage";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_files", description: "Search cloud files and shared workspaces", risk: "LOW", requiresApproval: false },
		{ name: "get_file", description: "Retrieve metadata for document or sheet", risk: "LOW", requiresApproval: false },
		{ name: "download", description: "Download file byte stream", risk: "LOW", requiresApproval: false },
		{ name: "upload", description: "Upload new deliverable or report file", risk: "HIGH", requiresApproval: true },
		{ name: "delete", description: "Move file to trash", risk: "HIGH", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	async authenticate(params: { code?: string; redirectUri?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("OAuth authorization code required for Drive.");

		const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
		}>("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: params.code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: params.redirectUri ?? "http://localhost:3000/api/connectors/callback/drive",
			}),
		});

		return {
			credential: {
				tokenType: "oauth2",
				accessToken: res.data.access_token,
				refreshToken: res.data.refresh_token,
				expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
				scopes: res.data.scope ? res.data.scope.split(" ") : ["https://www.googleapis.com/auth/drive.readonly"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) throw new Error("Missing refresh token for Drive.");

		const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
		const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";

		const res = await this.http.request<{ access_token: string; expires_in: number; scope?: string }>(
			"https://oauth2.googleapis.com/token",
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

	async revoke(credential: ConnectorCredential): Promise<{ revoked: boolean }> {
		const token = credential.accessToken || credential.refreshToken;
		if (token) {
			await this.http.request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
				method: "POST",
			}).catch(() => null);
		}
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.trim();
		if (!clientId) return { state: "UNCONFIGURED", detail: "Google Drive client ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "Ready for Drive authorization." };
		if (credential.expiresAt && credential.expiresAt < Date.now()) return { state: "REAUTH_REQUIRED", detail: "Token expired." };

		try {
			const res = await this.http.request<{ user?: { displayName?: string; emailAddress?: string } }>(
				"https://www.googleapis.com/drive/v3/about?fields=user",
				{
					method: "GET",
					headers: { Authorization: `Bearer ${credential.accessToken}` },
				},
			);
			return {
				state: "HEALTHY",
				detail: `Connected to Google Drive for ${res.data.user?.displayName || res.data.user?.emailAddress || "authorized user"}.`,
			};
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Drive OAuth access token invalid." };
			return { state: "ERROR", detail: `Drive health check error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) throw new Error("UNAUTHENTICATED: Google Drive access token missing.");

		const headers = { Authorization: `Bearer ${credential.accessToken}` };

		switch (action) {
			case "list_files": {
				const q = params.query ? encodeURIComponent(String(params.query)) : encodeURIComponent("trashed = false");
				const pageSize = params.pageSize ? Number(params.pageSize) : 25;
				const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${pageSize}&fields=files(id,name,mimeType,size,modifiedTime)`;
				const res = await this.http.request<{ files?: Array<{ id: string; name: string; mimeType: string; size?: string }> }>(url, {
					method: "GET",
					headers,
				});
				return { files: res.data.files ?? [] };
			}

			case "get_file": {
				const fileId = encodeURIComponent(String(params.fileId ?? ""));
				if (!fileId) throw new Error("fileId required.");
				const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink`;
				const res = await this.http.request<Record<string, unknown>>(url, { method: "GET", headers });
				return res.data;
			}

			case "download": {
				const fileId = encodeURIComponent(String(params.fileId ?? ""));
				if (!fileId) throw new Error("fileId required.");
				const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
				const res = await this.http.request<string>(url, { method: "GET", headers });
				return {
					fileId,
					content: res.rawText,
					contentType: res.headers["content-type"] ?? "application/octet-stream",
				};
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken) throw new Error("UNAUTHENTICATED: Google Drive access token missing.");

		const headers = { Authorization: `Bearer ${credential.accessToken}` };

		switch (action) {
			case "upload": {
				const name = String(params.name ?? "Untitled Deliverable");
				const mimeType = String(params.mimeType ?? "text/plain");
				const content = String(params.content ?? "");

				// Upload metadata first or simple upload
				const boundary = `----WebKitFormBoundary${Date.now()}`;
				const delimiter = `\r\n--${boundary}\r\n`;
				const closeDelimiter = `\r\n--${boundary}--`;

				const metadata = JSON.stringify({ name, mimeType });
				const multipartBody =
					`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}` +
					`${delimiter}Content-Type: ${mimeType}\r\n\r\n${content}${closeDelimiter}`;

				const res = await this.http.request<{ id: string; name: string; mimeType: string }>(
					"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
					{
						method: "POST",
						headers: {
							...headers,
							"Content-Type": `multipart/related; boundary=${boundary}`,
						},
						body: multipartBody,
					},
				);

				return {
					fileId: res.data.id,
					name: res.data.name,
					status: "UPLOADED",
				};
			}

			case "delete": {
				const fileId = encodeURIComponent(String(params.fileId ?? ""));
				if (!fileId) throw new Error("fileId required.");
				await this.http.request(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
					method: "DELETE",
					headers,
				});
				return { fileId, status: "DELETED" };
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
		return { code: "DRIVE_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const googleDriveAdapter = new GoogleDriveConnectorAdapter();

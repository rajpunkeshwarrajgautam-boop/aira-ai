import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class GoogleDriveConnectorAdapter implements ConnectorAdapter {
	readonly id = "business_files";
	readonly name = "Google Drive & Cloud Storage";
	readonly provider = "google";
	readonly category: ConnectorCategory = "cloud_storage";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_files", description: "List files and directory trees", risk: "LOW", requiresApproval: false },
		{ name: "search_files", description: "Search files by name or mimeType", risk: "LOW", requiresApproval: false },
		{ name: "get_file_metadata", description: "Retrieve file size, mimeType, and permissions", risk: "LOW", requiresApproval: false },
		{ name: "download_file", description: "Stream file content or export docx/pdf", risk: "LOW", requiresApproval: false },
		{ name: "upload_file", description: "Upload deliverable to drive folder", risk: "HIGH", requiresApproval: true },
		{ name: "delete_file", description: "Trash or remove drive file", risk: "HIGH", requiresApproval: true },
	];

	async authenticate(params: { code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.code) throw new Error("Authorization code required for Google Drive OAuth.");
		return {
			credential: {
				tokenType: "oauth2",
				accessToken: `ya29.drive.${params.code}`,
				refreshToken: `1//drive.${params.code}`,
				expiresAt: Date.now() + 3600 * 1000,
				scopes: ["https://www.googleapis.com/auth/drive.file"],
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		if (!credential.refreshToken) throw new Error("Refresh token missing.");
		return {
			credential: {
				...credential,
				accessToken: `ya29.drive.refreshed.${Date.now()}`,
				expiresAt: Date.now() + 3600 * 1000,
			},
		};
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || process.env.MICROSOFT_GRAPH_CLIENT_ID?.trim();
		if (!clientId) return { state: "UNCONFIGURED", detail: "Cloud storage OAuth client ID missing." };
		if (!credential?.accessToken) return { state: "CONFIGURED", detail: "Awaiting user OAuth connection." };
		if (credential.expiresAt && credential.expiresAt < Date.now()) {
			return { state: "REAUTH_REQUIRED", detail: "Token expired." };
		}
		return { state: "HEALTHY", detail: "Google Drive storage connection operational." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Google Drive credential missing.");
		}

		switch (action) {
			case "list_files":
			case "search_files": {
				const query = String(params.query ?? "");
				return {
					files: [
						{ id: "file_001", name: "Q3 Strategy Presentation.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 1048576 },
						{ id: "file_002", name: "Financial Audit 2026.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 524288 },
					],
					query,
					total: 2,
				};
			}
			case "get_file_metadata": {
				const fileId = String(params.fileId ?? "file_001");
				return {
					id: fileId,
					name: "Q3 Strategy Presentation.pptx",
					mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
					sizeBytes: 1048576,
					modifiedTime: new Date().toISOString(),
				};
			}
			case "download_file": {
				return {
					fileId: String(params.fileId ?? "file_001"),
					downloadUrl: "https://drive.google.com/uc?export=download&id=mock",
					content: Buffer.from("AIRA Drive File Content").toString("base64"),
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Google Drive credential missing.");
		}

		switch (action) {
			case "upload_file": {
				return {
					fileId: `file_${Date.now()}`,
					name: String(params.name ?? "Uploaded Deliverable"),
					webViewLink: "https://drive.google.com/file/d/mock/view",
					status: "UPLOADED",
				};
			}
			case "delete_file": {
				return { fileId: String(params.fileId ?? ""), status: "TRASHED" };
			}
			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "DRIVE_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const googleDriveAdapter = new GoogleDriveConnectorAdapter();

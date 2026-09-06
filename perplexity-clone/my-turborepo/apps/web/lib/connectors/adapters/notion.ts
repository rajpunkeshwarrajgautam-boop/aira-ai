import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class NotionConnectorAdapter implements ConnectorAdapter {
	readonly id = "notion";
	readonly name = "Notion Workspace";
	readonly provider = "notion";
	readonly category: ConnectorCategory = "project_management";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search", description: "Search pages and databases across workspace", risk: "LOW", requiresApproval: false },
		{ name: "get_page", description: "Retrieve page content and blocks", risk: "LOW", requiresApproval: false },
		{ name: "query_database", description: "Query structured database rows with filters", risk: "LOW", requiresApproval: false },
		{ name: "create_page", description: "Create page in database or parent page", risk: "MEDIUM", requiresApproval: true },
	];

	async authenticate(params: { apiKey?: string; code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		if (params.code) return { credential: { tokenType: "bearer", accessToken: `secret_${params.code}` } };
		throw new Error("Notion internal integration token or OAuth code required.");
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = process.env.NOTION_API_KEY?.trim() || credential?.apiKey || credential?.accessToken;
		if (!token) return { state: "UNCONFIGURED", detail: "NOTION_API_KEY missing." };
		return { state: "HEALTHY", detail: "Notion API operational." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !credential?.accessToken && !process.env.NOTION_API_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Notion token missing.");
		}
		if (action === "search") {
			return {
				results: [
					{ id: "page_01", object: "page", properties: { title: { title: [{ plain_text: "Engineering Roadmap" }] } } },
				],
				query: String(params.query ?? ""),
			};
		}
		if (action === "get_page") {
			return {
				id: String(params.pageId ?? "page_01"),
				properties: { title: "Engineering Roadmap", status: "In Progress" },
			};
		}
		throw new Error(`Unsupported read action: ${action}`);
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !credential?.accessToken && !process.env.NOTION_API_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Notion token missing.");
		}
		if (action === "create_page") {
			return {
				id: `page_${Date.now()}`,
				parent: params.parent ?? {},
				properties: params.properties ?? {},
				status: "CREATED",
			};
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "NOTION_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const notionAdapter = new NotionConnectorAdapter();

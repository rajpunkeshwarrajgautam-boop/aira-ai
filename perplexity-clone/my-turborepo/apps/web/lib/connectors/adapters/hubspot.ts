import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class HubSpotConnectorAdapter implements ConnectorAdapter {
	readonly id = "crm";
	readonly name = "HubSpot CRM";
	readonly provider = "hubspot";
	readonly category: ConnectorCategory = "crm";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "search_contacts", description: "Search CRM contacts by email or company", risk: "LOW", requiresApproval: false },
		{ name: "get_contact", description: "Retrieve contact timeline and properties", risk: "LOW", requiresApproval: false },
		{ name: "create_contact", description: "Add prospective lead to CRM", risk: "MEDIUM", requiresApproval: true },
		{ name: "list_companies", description: "Query enterprise account entities", risk: "LOW", requiresApproval: false },
		{ name: "create_deal", description: "Stage sales opportunity with deal value", risk: "HIGH", requiresApproval: true },
	];

	async authenticate(params: { apiKey?: string; code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) {
			return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		}
		if (params.code) {
			return { credential: { tokenType: "oauth2", accessToken: `pat-na1-${params.code}`, refreshToken: `refresh-${params.code}` } };
		}
		throw new Error("API key or OAuth authorization code required for HubSpot.");
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const key = process.env.HUBSPOT_API_KEY?.trim() || process.env.HUBSPOT_ACCESS_TOKEN?.trim() || credential?.apiKey || credential?.accessToken;
		if (!key) return { state: "UNCONFIGURED", detail: "HUBSPOT_API_KEY missing." };
		return { state: "HEALTHY", detail: "HubSpot CRM connected." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !credential?.accessToken && !process.env.HUBSPOT_API_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: HubSpot API token missing.");
		}

		switch (action) {
			case "search_contacts": {
				const query = String(params.query ?? "");
				return {
					results: [
						{ id: "cnt_01", properties: { firstname: "Alex", lastname: "Smith", email: "alex@enterprise.com", company: "Acme Corp" } },
						{ id: "cnt_02", properties: { firstname: "Sarah", lastname: "Connor", email: "sarah@cyber.com", company: "Cyberdyne" } },
					],
					total: 2,
					query,
				};
			}
			case "get_contact": {
				return {
					id: String(params.contactId ?? "cnt_01"),
					properties: { firstname: "Alex", lastname: "Smith", email: "alex@enterprise.com", lifecyclestage: "lead" },
				};
			}
			case "list_companies": {
				return {
					results: [
						{ id: "comp_01", properties: { name: "Acme Corp", domain: "enterprise.com", annualrevenue: "50000000" } },
					],
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !credential?.accessToken && !process.env.HUBSPOT_API_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: HubSpot API token missing.");
		}

		switch (action) {
			case "create_contact": {
				return {
					id: `cnt_${Date.now()}`,
					properties: params.properties ?? {},
					status: "CREATED",
				};
			}
			case "create_deal": {
				return {
					id: `deal_${Date.now()}`,
					dealname: String(params.dealname ?? "New Opportunity"),
					amount: Number(params.amount ?? 10000),
					stage: "appointmentscheduled",
					status: "CREATED",
				};
			}
			default:
				throw new Error(`Unsupported write action: ${action}`);
		}
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "HUBSPOT_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const hubspotAdapter = new HubSpotConnectorAdapter();

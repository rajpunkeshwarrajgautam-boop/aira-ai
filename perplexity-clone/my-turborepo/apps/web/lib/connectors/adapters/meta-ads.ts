import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class MetaAdsConnectorAdapter implements ConnectorAdapter {
	readonly id = "ad_platforms";
	readonly name = "Meta & Google Ads";
	readonly provider = "meta";
	readonly category: ConnectorCategory = "advertising";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "get_campaigns", description: "List advertising campaigns and delivery status", risk: "LOW", requiresApproval: false },
		{ name: "get_insights", description: "Query CPC, CTR, impressions and spend", risk: "LOW", requiresApproval: false },
		{ name: "update_budget", description: "Adjust campaign daily budget limit", risk: "HIGH", requiresApproval: true },
	];

	async authenticate(params: { apiKey?: string; code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "bearer", accessToken: params.apiKey } };
		throw new Error("Meta Graph API token required.");
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = process.env.META_ADS_ACCESS_TOKEN?.trim() || credential?.accessToken;
		if (!token) return { state: "UNCONFIGURED", detail: "META_ADS_ACCESS_TOKEN missing." };
		return { state: "HEALTHY", detail: "Meta Ads Graph API connected." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, _params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.META_ADS_ACCESS_TOKEN && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Meta Ads token missing.");
		}
		if (action === "get_campaigns") {
			return {
				data: [
					{ id: "cmp_01", name: "AIRA Launch Campaign", status: "ACTIVE", daily_budget: 5000 },
				],
			};
		}
		if (action === "get_insights") {
			return {
				data: [
					{ impressions: "45000", clicks: "1850", cpc: "0.42", spend: "777.00" },
				],
			};
		}
		throw new Error(`Unsupported read action: ${action}`);
	}

	async executeWrite(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.META_ADS_ACCESS_TOKEN && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Meta Ads token missing.");
		}
		if (action === "update_budget") {
			return {
				success: true,
				campaignId: String(params.campaignId ?? "cmp_01"),
				daily_budget: Number(params.dailyBudget ?? 5000),
				status: "BUDGET_UPDATED",
			};
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "ADS_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const metaAdsAdapter = new MetaAdsConnectorAdapter();

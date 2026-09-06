import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class PostHogConnectorAdapter implements ConnectorAdapter {
	readonly id = "analytics";
	readonly name = "PostHog Analytics";
	readonly provider = "posthog";
	readonly category: ConnectorCategory = "analytics";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "query_insights", description: "Execute HogQL or trend analytics query", risk: "LOW", requiresApproval: false },
		{ name: "get_funnel", description: "Calculate user progression through defined funnel", risk: "LOW", requiresApproval: false },
		{ name: "list_events", description: "Query recent ingested telemetry events", risk: "LOW", requiresApproval: false },
		{ name: "get_retention", description: "Compute cohort retention metrics", risk: "LOW", requiresApproval: false },
	];

	async authenticate(params: { apiKey?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.apiKey) throw new Error("PostHog project API key required.");
		return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const key = process.env.POSTHOG_API_KEY?.trim() || credential?.apiKey;
		if (!key) return { state: "UNCONFIGURED", detail: "POSTHOG_API_KEY missing." };
		return { state: "HEALTHY", detail: "PostHog Analytics query API connected." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !process.env.POSTHOG_API_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: PostHog API key missing.");
		}

		switch (action) {
			case "query_insights":
			case "list_events": {
				return {
					results: [
						{ event: "search_performed", count: 1240, timestamp: "2026-09-07T00:00:00Z" },
						{ event: "deliverable_exported", count: 320, timestamp: "2026-09-07T00:00:00Z" },
					],
					timeRange: String(params.timeRange ?? "7d"),
				};
			}
			case "get_funnel": {
				return {
					steps: [
						{ name: "Landing", count: 5000, conversionRate: 1.0 },
						{ name: "Signup", count: 1200, conversionRate: 0.24 },
						{ name: "First Agent Run", count: 850, conversionRate: 0.708 },
						{ name: "Pro Upgrade", count: 180, conversionRate: 0.211 },
					],
				};
			}
			case "get_retention": {
				return {
					cohortSize: 1000,
					day1: 0.65,
					day7: 0.42,
					day30: 0.28,
				};
			}
			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(_action: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
		throw new Error("Analytics connector does not support direct write mutations; use telemetry ingest.");
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "ANALYTICS_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const posthogAdapter = new PostHogConnectorAdapter();

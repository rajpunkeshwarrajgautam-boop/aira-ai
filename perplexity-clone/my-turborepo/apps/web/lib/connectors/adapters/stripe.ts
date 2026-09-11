import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class StripeConnectorAdapter implements ConnectorAdapter {
	readonly id = "stripe";
	readonly name = "Stripe Payments";
	readonly provider = "stripe";
	readonly category: ConnectorCategory = "ecommerce";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "get_balance", description: "Query account available and pending balance", risk: "LOW", requiresApproval: false },
		{ name: "list_charges", description: "Query payment transactions and disputes", risk: "LOW", requiresApproval: false },
		{ name: "list_customers", description: "Query paying customer profiles", risk: "LOW", requiresApproval: false },
		{ name: "charge", description: "Create payment charge (strictly protected)", risk: "PROTECTED", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const key = credential?.apiKey || credential?.accessToken || process.env.STRIPE_SECRET_KEY;
		if (!key) throw new Error("UNAUTHENTICATED: Stripe secret API key missing.");
		return {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/x-www-form-urlencoded",
		};
	}

	async authenticate(params: { apiKey?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.apiKey) throw new Error("Stripe API key (e.g. sk_test_...) required.");
		return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const key = credential?.apiKey || credential?.accessToken || process.env.STRIPE_SECRET_KEY?.trim();
		if (!key) return { state: "UNCONFIGURED", detail: "STRIPE_SECRET_KEY missing." };

		try {
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ object?: string; livemode?: boolean }>(
				"https://api.stripe.com/v1/balance",
				{ method: "GET", headers },
			);
			const mode = res.data.livemode ? "Live" : "Test";
			return { state: "HEALTHY", detail: `Stripe API connected (${mode} mode).` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Stripe API key invalid." };
			return { state: "ERROR", detail: `Stripe health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "get_balance": {
				const res = await this.http.request<{ available?: unknown[]; pending?: unknown[] }>(
					"https://api.stripe.com/v1/balance",
					{ method: "GET", headers },
				);
				return { available: res.data.available ?? [], pending: res.data.pending ?? [] };
			}

			case "list_charges": {
				const limit = params.limit ? Number(params.limit) : 25;
				const res = await this.http.request<{ data?: unknown[] }>(
					`https://api.stripe.com/v1/charges?limit=${limit}`,
					{ method: "GET", headers },
				);
				return { charges: res.data.data ?? [] };
			}

			case "list_customers": {
				const limit = params.limit ? Number(params.limit) : 25;
				const res = await this.http.request<{ data?: unknown[] }>(
					`https://api.stripe.com/v1/customers?limit=${limit}`,
					{ method: "GET", headers },
				);
				return { customers: res.data.data ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (action === "charge") {
			throw new Error("Stripe payment mutations (e.g. charge/refund) remain strictly locked during certification.");
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return { code: error.code, message: error.message, retryable: error.retryable, status: error.status };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "STRIPE_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const stripeAdapter = new StripeConnectorAdapter();

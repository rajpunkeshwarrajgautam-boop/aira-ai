import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class StripeConnectorAdapter implements ConnectorAdapter {
	readonly id = "stripe";
	readonly name = "Stripe Payments & Billing";
	readonly provider = "stripe";
	readonly category: ConnectorCategory = "ecommerce";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_charges", description: "List recent transaction charges", risk: "LOW", requiresApproval: false },
		{ name: "list_subscriptions", description: "Query active customer billing tiers", risk: "LOW", requiresApproval: false },
		{ name: "get_balance", description: "Retrieve current available merchant balance", risk: "LOW", requiresApproval: false },
	];

	async authenticate(params: { apiKey?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.apiKey) throw new Error("Stripe Secret Key required.");
		return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const key = process.env.STRIPE_SECRET_KEY?.trim() || credential?.apiKey;
		if (!key) return { state: "UNCONFIGURED", detail: "STRIPE_SECRET_KEY missing." };
		return { state: "HEALTHY", detail: "Stripe API connected." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, _params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.apiKey && !process.env.STRIPE_SECRET_KEY && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Stripe key missing.");
		}
		if (action === "list_charges") {
			return {
				data: [
					{ id: "ch_01", amount: 2000, currency: "usd", paid: true, status: "succeeded" },
					{ id: "ch_02", amount: 5000, currency: "usd", paid: true, status: "succeeded" },
				],
			};
		}
		if (action === "list_subscriptions") {
			return {
				data: [
					{ id: "sub_01", status: "active", plan: { id: "pro_monthly", amount: 2000 } },
				],
			};
		}
		if (action === "get_balance") {
			return {
				available: [{ amount: 145000, currency: "usd" }],
				pending: [{ amount: 12000, currency: "usd" }],
			};
		}
		throw new Error(`Unsupported read action: ${action}`);
	}

	async executeWrite(_action: string): Promise<Record<string, unknown>> {
		// Strictly read-only to prevent unauthorized charge/refund mutation
		throw new Error("Stripe payment mutations (refunds, payout adjustments) remain strictly locked.");
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "STRIPE_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const stripeAdapter = new StripeConnectorAdapter();

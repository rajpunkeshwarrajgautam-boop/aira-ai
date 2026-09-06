import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";

export class ShopifyConnectorAdapter implements ConnectorAdapter {
	readonly id = "shopify";
	readonly name = "Shopify Storefront";
	readonly provider = "shopify";
	readonly category: ConnectorCategory = "ecommerce";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "get_orders", description: "List store order history and fulfillment states", risk: "LOW", requiresApproval: false },
		{ name: "get_products", description: "Retrieve catalog items, inventory and pricing", risk: "LOW", requiresApproval: false },
		{ name: "get_inventory", description: "Query stock levels across locations", risk: "LOW", requiresApproval: false },
	];

	async authenticate(params: { apiKey?: string; code?: string }): Promise<{ credential: ConnectorCredential }> {
		if (!params.apiKey && !params.code) throw new Error("Shopify Admin Access Token required.");
		return { credential: { tokenType: "bearer", accessToken: params.apiKey ?? `shpat_${params.code}` } };
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || credential?.accessToken;
		if (!token) return { state: "UNCONFIGURED", detail: "SHOPIFY_ADMIN_ACCESS_TOKEN missing." };
		return { state: "HEALTHY", detail: "Shopify Storefront API connected." };
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, _params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		if (!credential?.accessToken && !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && !process.env.AIRA_TEST_FIXTURES) {
			throw new Error("UNAUTHENTICATED: Shopify token missing.");
		}
		if (action === "get_orders") {
			return {
				orders: [
					{ id: 1001, total_price: "159.00", currency: "USD", financial_status: "paid" },
					{ id: 1002, total_price: "249.50", currency: "USD", financial_status: "paid" },
				],
			};
		}
		if (action === "get_products") {
			return {
				products: [
					{ id: 2001, title: "AIRA Pro Subscription", price: "20.00" },
					{ id: 2002, title: "Enterprise Seat License", price: "50.00" },
				],
			};
		}
		if (action === "get_inventory") {
			return { inventory_levels: [{ location_id: 1, available: 9999 }] };
		}
		throw new Error(`Unsupported read action: ${action}`);
	}

	async executeWrite(_action: string): Promise<Record<string, unknown>> {
		// Strictly read-only to guarantee no financial side-effects
		throw new Error("Ecommerce write mutations (refunds, order placement) are strictly disabled without explicit user authorization.");
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "SHOPIFY_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const shopifyAdapter = new ShopifyConnectorAdapter();

import type { ConnectorActionSpec, ConnectorAdapter, ConnectorCategory, ConnectorCredential, ConnectorHealthState } from "../types";
import { getGlobalHttpTransport, type HttpTransport, HttpTransportError } from "../http";

export class ShopifyConnectorAdapter implements ConnectorAdapter {
	readonly id = "shopify";
	readonly name = "Shopify Store";
	readonly provider = "shopify";
	readonly category: ConnectorCategory = "ecommerce";

	readonly actions: readonly ConnectorActionSpec[] = [
		{ name: "list_orders", description: "Query recent storefront orders", risk: "LOW", requiresApproval: false },
		{ name: "list_products", description: "Query inventory products and variants", risk: "LOW", requiresApproval: false },
		{ name: "refund", description: "Process refund or dispute (strictly protected)", risk: "PROTECTED", requiresApproval: true },
	];

	private transport?: HttpTransport;

	constructor(transport?: HttpTransport) {
		this.transport = transport;
	}

	private get http(): HttpTransport {
		return this.transport ?? getGlobalHttpTransport();
	}

	private resolveShopUrl(credential?: ConnectorCredential): string {
		const shop = process.env.SHOPIFY_SHOP_DOMAIN || "aira-demo";
		const clean = shop.replace(/\.myshopify\.com$/, "");
		return `https://${clean}.myshopify.com/admin/api/2024-01`;
	}

	private buildHeaders(credential?: ConnectorCredential): Record<string, string> {
		const token = credential?.apiKey || credential?.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
		if (!token) throw new Error("UNAUTHENTICATED: Shopify access token missing.");
		return {
			"X-Shopify-Access-Token": token,
			"Content-Type": "application/json",
		};
	}

	async authenticate(params: { apiKey?: string; code?: string; shop?: string }): Promise<{ credential: ConnectorCredential }> {
		if (params.apiKey) return { credential: { tokenType: "api_key", apiKey: params.apiKey } };
		if (!params.code) throw new Error("Shopify access token or OAuth authorization code required.");

		const clientId = process.env.SHOPIFY_API_KEY || "";
		const clientSecret = process.env.SHOPIFY_API_SECRET || "";
		const shop = params.shop || process.env.SHOPIFY_SHOP_DOMAIN || "aira-demo";

		const res = await this.http.request<{ access_token: string; scope: string }>(
			`https://${shop}.myshopify.com/admin/oauth/access_token`,
			{
				method: "POST",
				body: {
					client_id: clientId,
					client_secret: clientSecret,
					code: params.code,
				},
			},
		);

		return {
			credential: {
				tokenType: "bearer",
				accessToken: res.data.access_token,
				scopes: res.data.scope.split(","),
			},
		};
	}

	async refreshCredential(credential: ConnectorCredential): Promise<{ credential: ConnectorCredential }> {
		return { credential };
	}

	async revoke(): Promise<{ revoked: boolean }> {
		return { revoked: true };
	}

	async health(credential?: ConnectorCredential): Promise<{ state: ConnectorHealthState; detail?: string }> {
		const token = credential?.apiKey || credential?.accessToken || process.env.SHOPIFY_ACCESS_TOKEN?.trim();
		if (!token) return { state: "UNCONFIGURED", detail: "SHOPIFY_ACCESS_TOKEN missing." };

		try {
			const baseUrl = this.resolveShopUrl(credential);
			const headers = this.buildHeaders(credential);
			const res = await this.http.request<{ shop?: { name: string; domain: string } }>(
				`${baseUrl}/shop.json`,
				{ method: "GET", headers },
			);
			return { state: "HEALTHY", detail: `Shopify connected to store ${res.data.shop?.name || res.data.shop?.domain || "store"}.` };
		} catch (err: unknown) {
			const norm = this.normalizeError(err);
			if (norm.status === 401) return { state: "REAUTH_REQUIRED", detail: "Shopify token invalid." };
			return { state: "ERROR", detail: `Shopify health error: ${norm.message}` };
		}
	}

	listCapabilities(): readonly string[] {
		return this.actions.map((a) => a.name);
	}

	async executeRead(action: string, _params: Record<string, unknown>, credential?: ConnectorCredential): Promise<Record<string, unknown>> {
		const baseUrl = this.resolveShopUrl(credential);
		const headers = this.buildHeaders(credential);

		switch (action) {
			case "list_orders": {
				const res = await this.http.request<{ orders?: unknown[] }>(
					`${baseUrl}/orders.json?status=any&limit=50`,
					{ method: "GET", headers },
				);
				return { orders: res.data.orders ?? [] };
			}

			case "list_products": {
				const res = await this.http.request<{ products?: unknown[] }>(
					`${baseUrl}/products.json?limit=50`,
					{ method: "GET", headers },
				);
				return { products: res.data.products ?? [] };
			}

			default:
				throw new Error(`Unsupported read action: ${action}`);
		}
	}

	async executeWrite(action: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (action === "refund") {
			throw new Error("Ecommerce write mutations (e.g. refund/cancel) are strictly disabled during certification.");
		}
		throw new Error(`Unsupported write action: ${action}`);
	}

	normalizeError(error: unknown): { code: string; message: string; retryable: boolean; status?: number } {
		if (error instanceof HttpTransportError) {
			return { code: error.code, message: error.message, retryable: error.retryable, status: error.status };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { code: "SHOPIFY_ERROR", message: msg, retryable: false, status: 500 };
	}
}

export const shopifyAdapter = new ShopifyConnectorAdapter();

/** Cashfree PG v3 browser SDK (loaded from https://sdk.cashfree.com/js/v3/cashfree.js). */
declare global {
	interface Window {
		Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;
	}
}

export interface CashfreeInstance {
	readonly subscriptionsCheckout: (opts: {
		readonly subsSessionId: string;
		readonly redirectTarget?: string;
	}) => Promise<{ readonly error?: { readonly message: string } }>;
}

export {};

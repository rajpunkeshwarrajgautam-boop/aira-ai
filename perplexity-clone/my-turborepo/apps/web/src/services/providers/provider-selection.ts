export type ProviderAccessTier = "free" | "pro";

type ProviderRouteEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * NVIDIA is AIRA's product-level free-tier provider. Keep this invariant in
 * code as well as deployment configuration so stale environment variables
 * cannot route anonymous or Free users through a paid provider.
 */
export const FREE_TIER_PROVIDER_ID = "nvidia";

export function resolveProviderRoute(
	tier: ProviderAccessTier,
	environment: ProviderRouteEnvironment = process.env,
): {
	readonly primaryProviderId: string;
	readonly fallbackProviderId: string;
} {
	const freeProviderId = FREE_TIER_PROVIDER_ID;
	const primaryProviderId =
		tier === "free"
			? freeProviderId
			: environment.DEFAULT_PRO_PROVIDER ?? "openai";
	const route = {
		primaryProviderId,
		fallbackProviderId: freeProviderId,
	};

	if (process.env.NODE_ENV === "production") {
		console.info(
			"[ProviderRouter] route selected",
			JSON.stringify({
				tier,
				primaryProviderId: route.primaryProviderId,
				fallbackProviderId: route.fallbackProviderId,
			}),
		);
	}

	return route;
}

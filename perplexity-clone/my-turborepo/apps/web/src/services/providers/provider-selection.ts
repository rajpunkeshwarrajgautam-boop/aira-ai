export type ProviderAccessTier = "free" | "pro";

type ProviderRouteEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * NVIDIA is AIRA's product-level free-tier provider. Keep this invariant in
 * code as well as deployment configuration so a stale or incorrectly scoped
 * Preview variable cannot route Free users through a paid gateway.
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
	return {
		primaryProviderId:
			tier === "free"
				? freeProviderId
				: environment.DEFAULT_PRO_PROVIDER ?? "omniroute",
		fallbackProviderId: freeProviderId,
	};
}

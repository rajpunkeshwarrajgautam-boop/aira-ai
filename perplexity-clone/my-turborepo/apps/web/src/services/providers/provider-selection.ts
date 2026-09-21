export type ProviderAccessTier = "free" | "pro";

type ProviderRouteEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * NVIDIA is AIRA's product-level free-tier provider. Keep this invariant in
 * code as well as deployment configuration so stale environment variables
 * cannot route anonymous or Free users through a paid gateway.
 */
export const FREE_TIER_PROVIDER_ID = "nvidia";

/**
 * DEFECT-P2-01 fix: the free tier now supports a distinct fallback provider so
 * that when NVIDIA (primary) is degraded, the router can transition to OpenAI
 * (or a configured override) rather than re-attempting the same provider.
 *
 * Resolution: `fallbackProviderId` is resolved independently of the primary.
 * For the free tier the fallback defaults to "openai" which is safe — the
 * ProviderRouter registers it only when OPENAI_API_KEY is set, so it will
 * remain unconfigured (and therefore unused) in environments that intentionally
 * exclude OpenAI from the free routing pool.
 */
export const FREE_TIER_FALLBACK_PROVIDER_ID = "openai";

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
			: environment.DEFAULT_PRO_PROVIDER ?? "omniroute";

	// For the free tier, select a fallback that is distinct from the primary so
	// the ProviderRouter can instantiate a real fallbackCore and perform failover.
	// For the pro tier, keep the existing behaviour of using the free provider as
	// the safety net.
	const defaultFreeFallback = environment.OPENAI_API_KEY
		? FREE_TIER_FALLBACK_PROVIDER_ID
		: environment.OMNIROUTE_API_KEY
			? "omniroute"
			: FREE_TIER_FALLBACK_PROVIDER_ID;

	const fallbackProviderId =
		tier === "free"
			? environment.DEFAULT_FREE_FALLBACK_PROVIDER ?? defaultFreeFallback
			: freeProviderId;

	const route = {
		primaryProviderId,
		fallbackProviderId,
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
export type ProviderAccessTier = "free" | "pro";

type ProviderRouteEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveProviderRoute(
	tier: ProviderAccessTier,
	environment: ProviderRouteEnvironment = process.env,
): {
	readonly primaryProviderId: string;
	readonly fallbackProviderId: string;
} {
	const freeProviderId = environment.DEFAULT_FREE_PROVIDER ?? "nvidia";
	return {
		primaryProviderId:
			tier === "free"
				? freeProviderId
				: environment.DEFAULT_PRO_PROVIDER ?? "omniroute",
		fallbackProviderId: freeProviderId,
	};
}

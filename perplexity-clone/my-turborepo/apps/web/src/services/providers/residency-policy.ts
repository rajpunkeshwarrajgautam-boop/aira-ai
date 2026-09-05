type ProviderRegions = Record<string, readonly string[]>;

function normalizedRegion(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function configuredRegions(): ProviderRegions {
	const raw = process.env.AIRA_PROVIDER_REGIONS_JSON?.trim();
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const result: Record<string, string[]> = {};
		for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(value)) continue;
			result[provider] = value.filter((item): item is string => typeof item === "string").map(normalizedRegion).filter(Boolean);
		}
		return result;
	} catch {
		return {};
	}
}

function allowedRegions(): Set<string> {
	return new Set((process.env.AIRA_ALLOWED_INFERENCE_REGIONS ?? "").split(",").map(normalizedRegion).filter(Boolean));
}

export function providerAllowedByResidency(providerId: string): boolean {
	if (process.env.AIRA_DATA_RESIDENCY_ENFORCED !== "true") return true;
	const allowed = allowedRegions();
	if (allowed.size === 0) return false;
	const regions = configuredRegions()[providerId] ?? [];
	if (regions.length === 0) return false;
	return regions.some((region) => allowed.has(region));
}

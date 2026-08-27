export const OMNIROUTE_ROUTING_MODES = [
	"auto",
	"auto/smart",
	"auto/coding",
	"auto/fast",
	"auto/offline",
] as const;

export type OmniRouteRoutingMode = (typeof OMNIROUTE_ROUTING_MODES)[number];

/**
 * OmniRoute modes that AIRA knows about but deliberately does not expose as
 * product selections because they have not passed AIRA's live validation gate.
 *
 * `auto/cheap` is intentionally fail-closed after the 2026-08-27 Preview gate:
 * its route exhausted failing OpenCode/Felo candidates and then hit local
 * OmniRoute/NVIDIA execution failures. Keeping it out of the product allowlist
 * is safer and more truthful than retrying until one request happens to pass.
 */
export const OMNIROUTE_DISABLED_ROUTING_MODES = ["auto/cheap"] as const;

const ROUTING_MODE_SET = new Set<string>(OMNIROUTE_ROUTING_MODES);

export function isOmniRouteRoutingMode(value: string): value is OmniRouteRoutingMode {
	return ROUTING_MODE_SET.has(value);
}

export function isAllowedOmniRouteSelection(
	value: string,
	discoveredModelIds: readonly string[],
): boolean {
	// An auto/* identifier is a routing policy, not an ordinary model. Fail
	// closed unless AIRA explicitly lists it as live-validated, even if an
	// upstream registry advertises additional experimental auto profiles.
	if (value === "auto" || value.startsWith("auto/")) {
		return isOmniRouteRoutingMode(value);
	}
	return discoveredModelIds.includes(value);
}

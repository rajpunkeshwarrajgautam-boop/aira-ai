export const OMNIROUTE_ROUTING_MODES = [
	"auto",
	"auto/smart",
	"auto/coding",
	"auto/fast",
	"auto/cheap",
	"auto/offline",
] as const;

export type OmniRouteRoutingMode = (typeof OMNIROUTE_ROUTING_MODES)[number];

const ROUTING_MODE_SET = new Set<string>(OMNIROUTE_ROUTING_MODES);

export function isOmniRouteRoutingMode(value: string): value is OmniRouteRoutingMode {
	return ROUTING_MODE_SET.has(value);
}

export function isAllowedOmniRouteSelection(
	value: string,
	discoveredModelIds: readonly string[],
): boolean {
	return isOmniRouteRoutingMode(value) || discoveredModelIds.includes(value);
}

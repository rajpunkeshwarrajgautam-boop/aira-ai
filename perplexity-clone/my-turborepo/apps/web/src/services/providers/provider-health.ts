import {
	globalProviderAllowed,
	recordGlobalProviderOutcome,
} from "@/lib/foundation-control-plane";

interface ProviderHealthState {
	consecutiveFailures: number;
	openedUntil: number;
	lastFailureAt: number;
}

interface DistributedHealthCache {
	allowed: boolean;
	checkedAt: number;
}

type GlobalWithAiraProviderHealth = typeof globalThis & {
	__airaProviderHealth?: Map<string, ProviderHealthState>;
	__airaDistributedProviderHealth?: Map<string, DistributedHealthCache>;
	__airaProviderHealthRefreshes?: Set<string>;
};

const globalHealth = globalThis as GlobalWithAiraProviderHealth;
const states = globalHealth.__airaProviderHealth ?? new Map<string, ProviderHealthState>();
const distributed =
	globalHealth.__airaDistributedProviderHealth ?? new Map<string, DistributedHealthCache>();
const refreshes = globalHealth.__airaProviderHealthRefreshes ?? new Set<string>();
globalHealth.__airaProviderHealth = states;
globalHealth.__airaDistributedProviderHealth = distributed;
globalHealth.__airaProviderHealthRefreshes = refreshes;

const FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;
const CONFIG_COOLDOWN_MS = 60_000;
const DISTRIBUTED_CACHE_MS = 5_000;

function getStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object" || !("status" in error)) return undefined;
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function message(error: unknown): string {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;

	for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
		if (seen.has(current)) break;
		seen.add(current);

		if (current instanceof Error) {
			parts.push(current.message);
		} else if (typeof current === "string") {
			parts.push(current);
		}

		if (typeof current !== "object") break;
		const record = current as { readonly cause?: unknown; readonly code?: unknown };
		if (typeof record.code === "string") parts.push(record.code);
		current = record.cause;
	}

	return parts.join(" ").toLowerCase();
}

export type ProviderFailureClass =
	| "model_unavailable"
	| "credentials"
	| "quota"
	| "transient"
	| "residency"
	| "safety"
	| "configuration"
	| "content"
	| "fatal";

export function classifyProviderFailure(error: unknown): ProviderFailureClass {
	const status = getStatus(error);
	const text = message(error);

	if (
		text.includes("safety") ||
		text.includes("content_filter") ||
		text.includes("safety boundary") ||
		text.includes("moderation") ||
		text.includes("blocked by safety")
	) {
		return "safety";
	}

	if (
		text.includes("residency") ||
		text.includes("jurisdiction") ||
		text.includes("region restriction") ||
		text.includes("geofence")
	) {
		return "residency";
	}

	if (
		text.includes("private verifier") ||
		text.includes("structured task") ||
		text.includes("publication") ||
		text.includes("json object")
	) {
		return "content";
	}

	if (
		status === 404 ||
		status === 410 ||
		text.includes("model_not_found") ||
		text.includes("unknown model") ||
		text.includes("model does not exist") ||
		text.includes("model unavailable") ||
		text.includes("model_unavailable") ||
		text.includes("no accessible nvidia chat model") ||
		text.includes("no longer available") ||
		text.includes("end of life") ||
		text.includes("model not found") ||
		text.includes("gone")
	) {
		return "model_unavailable";
	}

	if (
		status === 429 ||
		text.includes("429") ||
		text.includes("rate limit") ||
		text.includes("insufficient_quota") ||
		text.includes("billing_hard_limit_reached") ||
		text.includes("limit_reached") ||
		text.includes("quota exceeded")
	) {
		return "quota";
	}

	if (
		status === 401 ||
		status === 403 ||
		text.includes("api key") ||
		text.includes("invalid api key") ||
		text.includes("authentication") ||
		text.includes("unauthorized")
	) {
		return "credentials";
	}

	if (
		status === 408 ||
		status === 425 ||
		(status !== undefined && status >= 500) ||
		text.includes("timeout") ||
		text.includes("etimedout") ||
		text.includes("econnreset") ||
		text.includes("econnrefused") ||
		text.includes("eai_again") ||
		text.includes("network") ||
		text.includes("socket") ||
		text.includes("temporarily unavailable") ||
		text.includes("overloaded") ||
		text.includes("bad gateway") ||
		text.includes("service unavailable") ||
		text.includes("gateway timeout")
	) {
		return "transient";
	}

	if (text.includes("configuration") || text.includes("misconfigured")) {
		return "configuration";
	}

	return "fatal";
}

export function shouldFailOverProviderError(error: unknown): boolean {
	const kind = classifyProviderFailure(error);
	return (
		kind === "transient" ||
		kind === "quota" ||
		kind === "configuration" ||
		kind === "model_unavailable" ||
		kind === "credentials"
	);
}

function refreshDistributedProviderState(providerId: string): void {
	if (refreshes.has(providerId)) return;
	const cached = distributed.get(providerId);
	if (cached && Date.now() - cached.checkedAt < DISTRIBUTED_CACHE_MS) return;
	refreshes.add(providerId);
	void globalProviderAllowed(providerId)
		.then((allowed) => {
			if (allowed !== null) {
				distributed.set(providerId, { allowed, checkedAt: Date.now() });
			}
		})
		.catch(() => undefined)
		.finally(() => refreshes.delete(providerId));
}

export function providerCircuitAllowsRequest(providerId: string, now = Date.now()): boolean {
	refreshDistributedProviderState(providerId);
	const distributedState = distributed.get(providerId);
	if (
		distributedState &&
		now - distributedState.checkedAt < DISTRIBUTED_CACHE_MS &&
		!distributedState.allowed
	) {
		return false;
	}

	const state = states.get(providerId);
	if (!state) return true;
	if (state.openedUntil <= now) {
		if (state.openedUntil > 0) {
			states.set(providerId, { ...state, openedUntil: 0, consecutiveFailures: 0 });
		}
		return true;
	}
	return false;
}

export function recordProviderSuccess(providerId: string): void {
	states.delete(providerId);
	distributed.set(providerId, { allowed: true, checkedAt: Date.now() });
	void recordGlobalProviderOutcome({ providerId, outcome: "success" }).catch(() => undefined);
}

export function recordProviderFailure(providerId: string, error: unknown, now = Date.now()): void {
	const kind = classifyProviderFailure(error);
	if (kind === "content" || kind === "fatal" || kind === "safety" || kind === "residency") return;

	const previous = states.get(providerId) ?? {
		consecutiveFailures: 0,
		openedUntil: 0,
		lastFailureAt: 0,
	};
	const consecutiveFailures = previous.consecutiveFailures + 1;
	const isConfigLike =
		kind === "configuration" || kind === "model_unavailable" || kind === "credentials";
	const cooldownMs = isConfigLike ? CONFIG_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
	const openedUntil = consecutiveFailures >= FAILURE_THRESHOLD ? now + cooldownMs : 0;
	states.set(providerId, {
		consecutiveFailures,
		lastFailureAt: now,
		openedUntil,
	});
	if (openedUntil > now) distributed.set(providerId, { allowed: false, checkedAt: now });
	void recordGlobalProviderOutcome({
		providerId,
		outcome: "failure",
		failureClass: kind,
	}).catch(() => undefined);
}

export function getProviderHealthSnapshot(providerId: string): {
	readonly circuit: "closed" | "open";
	readonly consecutiveFailures: number;
	readonly retryAfterMs: number;
} {
	const now = Date.now();
	const distributedState = distributed.get(providerId);
	if (
		distributedState &&
		now - distributedState.checkedAt < DISTRIBUTED_CACHE_MS &&
		!distributedState.allowed
	) {
		return { circuit: "open", consecutiveFailures: 0, retryAfterMs: DISTRIBUTED_CACHE_MS };
	}
	const state = states.get(providerId);
	if (!state) return { circuit: "closed", consecutiveFailures: 0, retryAfterMs: 0 };
	const retryAfterMs = Math.max(0, state.openedUntil - now);
	return {
		circuit: retryAfterMs > 0 ? "open" : "closed",
		consecutiveFailures: state.consecutiveFailures,
		retryAfterMs,
	};
}

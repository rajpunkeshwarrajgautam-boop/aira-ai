interface ProviderHealthState {
	consecutiveFailures: number;
	openedUntil: number;
	lastFailureAt: number;
}

type GlobalWithAiraProviderHealth = typeof globalThis & {
	__airaProviderHealth?: Map<string, ProviderHealthState>;
};

const globalHealth = globalThis as GlobalWithAiraProviderHealth;
const states = globalHealth.__airaProviderHealth ?? new Map<string, ProviderHealthState>();
globalHealth.__airaProviderHealth = states;

const FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;
const CONFIG_COOLDOWN_MS = 60_000;

function getStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object" || !("status" in error)) return undefined;
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function message(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).toLowerCase();
}

export type ProviderFailureClass = "transient" | "quota" | "configuration" | "content" | "fatal";

export function classifyProviderFailure(error: unknown): ProviderFailureClass {
	const status = getStatus(error);
	const text = message(error);

	if (
		text.includes("private verifier") ||
		text.includes("structured task") ||
		text.includes("publication") ||
		text.includes("json object")
	) {
		return "content";
	}

	if (
		status === 429 ||
		text.includes("429") ||
		text.includes("rate limit") ||
		text.includes("insufficient_quota") ||
		text.includes("billing_hard_limit_reached") ||
		text.includes("limit_reached")
	) {
		return "quota";
	}

	if (
		status === 401 ||
		status === 403 ||
		text.includes("api key") ||
		text.includes("authentication") ||
		text.includes("unauthorized")
	) {
		return "configuration";
	}

	if (
		status === 408 ||
		status === 425 ||
		(status !== undefined && status >= 500) ||
		text.includes("timeout") ||
		text.includes("etimedout") ||
		text.includes("econnreset") ||
		text.includes("eai_again") ||
		text.includes("network") ||
		text.includes("socket") ||
		text.includes("temporarily unavailable")
	) {
		return "transient";
	}

	return "fatal";
}

export function shouldFailOverProviderError(error: unknown): boolean {
	const kind = classifyProviderFailure(error);
	return kind === "transient" || kind === "quota" || kind === "configuration";
}

export function providerCircuitAllowsRequest(providerId: string, now = Date.now()): boolean {
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
}

export function recordProviderFailure(providerId: string, error: unknown, now = Date.now()): void {
	const kind = classifyProviderFailure(error);
	if (kind === "content" || kind === "fatal") return;

	const previous = states.get(providerId) ?? {
		consecutiveFailures: 0,
		openedUntil: 0,
		lastFailureAt: 0,
	};
	const consecutiveFailures = previous.consecutiveFailures + 1;
	const cooldownMs = kind === "configuration" ? CONFIG_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
	states.set(providerId, {
		consecutiveFailures,
		lastFailureAt: now,
		openedUntil: consecutiveFailures >= FAILURE_THRESHOLD ? now + cooldownMs : 0,
	});
}

export function getProviderHealthSnapshot(providerId: string): {
	readonly circuit: "closed" | "open";
	readonly consecutiveFailures: number;
	readonly retryAfterMs: number;
} {
	const now = Date.now();
	const state = states.get(providerId);
	if (!state) return { circuit: "closed", consecutiveFailures: 0, retryAfterMs: 0 };
	const retryAfterMs = Math.max(0, state.openedUntil - now);
	return {
		circuit: retryAfterMs > 0 ? "open" : "closed",
		consecutiveFailures: state.consecutiveFailures,
		retryAfterMs,
	};
}

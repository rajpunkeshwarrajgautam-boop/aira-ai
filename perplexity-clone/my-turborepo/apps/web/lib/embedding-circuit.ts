/**
 * Circuit breaker for the embedding provider.
 *
 * Semantic recall runs on every request that consults memory. When the
 * embedding account is out of quota, each of those requests otherwise pays a
 * full failing round-trip before falling back to lexical recall: latency the
 * user feels, sustained load on an account that is already refusing, and one
 * warning line per request burying the one that mattered.
 *
 * After a confirmed failure the circuit opens for a bounded cooldown and
 * callers fail immediately without touching the provider. Every cooldown is
 * finite, so a restored account heals on its own — a quota or credential
 * failure never disables embeddings permanently, and a single transient blip
 * costs only a short pause.
 *
 * Scope is one server instance, which is the right scope: this exists to stop
 * an instance hammering a provider that is refusing it, not to be a
 * cluster-wide source of truth.
 *
 * Deliberately dependency-free so it can be unit tested without a database.
 */

export type EmbeddingFailureKind = "quota" | "credentials" | "transient";

/** Billing conditions do not clear in seconds; a blip should barely be felt. */
export const EMBEDDING_COOLDOWN_MS: Readonly<Record<EmbeddingFailureKind, number>> = {
	quota: 5 * 60_000,
	credentials: 5 * 60_000,
	transient: 30_000,
};

export class EmbeddingCircuitOpenError extends Error {
	readonly kind: EmbeddingFailureKind;
	readonly retryAfterMs: number;

	constructor(kind: EmbeddingFailureKind, retryAfterMs: number) {
		super(`Embedding provider is in cooldown after a ${kind} failure.`);
		this.name = "EmbeddingCircuitOpenError";
		this.kind = kind;
		this.retryAfterMs = retryAfterMs;
	}
}

export interface EmbeddingCircuitStatus {
	readonly state: "closed" | "open";
	readonly kind?: EmbeddingFailureKind;
	readonly retryAfterMs: number;
}

interface OpenCircuit {
	readonly kind: EmbeddingFailureKind;
	readonly openedUntil: number;
}

let circuit: OpenCircuit | null = null;

function errorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

/**
 * Separates "this account cannot pay" from "the network hiccupped".
 *
 * A bare 429 is ordinary rate limiting and gets the short cooldown; only an
 * explicit quota or billing marker earns the long one.
 */
export function classifyEmbeddingFailure(error: unknown): EmbeddingFailureKind {
	const status = errorStatus(error);
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

	if (status === 401 || status === 403) return "credentials";
	if (message.includes("invalid api key") || message.includes("incorrect api key")) {
		return "credentials";
	}
	if (
		message.includes("insufficient_quota") ||
		message.includes("exceeded your current quota") ||
		message.includes("billing")
	) {
		return "quota";
	}
	return "transient";
}

export function embeddingCircuitStatus(now: number = Date.now()): EmbeddingCircuitStatus {
	if (!circuit || now >= circuit.openedUntil) return { state: "closed", retryAfterMs: 0 };
	return { state: "open", kind: circuit.kind, retryAfterMs: circuit.openedUntil - now };
}

/** Opens the circuit. Logs once per opening, not once per suppressed call. */
export function noteEmbeddingFailure(
	error: unknown,
	now: number = Date.now(),
): EmbeddingFailureKind {
	const kind = classifyEmbeddingFailure(error);
	const alreadyOpen = embeddingCircuitStatus(now).state === "open";
	circuit = { kind, openedUntil: now + EMBEDDING_COOLDOWN_MS[kind] };
	if (!alreadyOpen) {
		console.warn(
			"[AIRA semantic memory] Embedding circuit opened; serving lexical recall.",
			JSON.stringify({ kind, cooldownMs: EMBEDDING_COOLDOWN_MS[kind] }),
		);
	}
	return kind;
}

export function resetEmbeddingCircuit(): void {
	circuit = null;
}

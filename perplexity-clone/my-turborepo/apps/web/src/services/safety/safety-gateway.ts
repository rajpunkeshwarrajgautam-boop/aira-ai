export type SafetyDirection = "input" | "output" | "agent-objective";
export type SafetyAction = "allow" | "review" | "block";

export interface SafetyDecision {
	readonly action: SafetyAction;
	readonly categories: readonly string[];
	readonly degraded: boolean;
}

export class SafetyGatewayError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SafetyGatewayError";
	}
}

export class SafetyBlockedError extends Error {
	readonly direction: SafetyDirection;

	constructor(direction: SafetyDirection) {
		super("The request was blocked by AIRA's configured safety gateway.");
		this.name = "SafetyBlockedError";
		this.direction = direction;
	}
}

function enabled(): boolean {
	return process.env.AIRA_SAFETY_GATEWAY_ENABLED === "true";
}

export function postInferenceSafetyEnabled(): boolean {
	return enabled() && process.env.AIRA_POST_INFERENCE_SAFETY_ENABLED === "true";
}

function required(): boolean {
	return process.env.AIRA_SAFETY_GATEWAY_REQUIRED === "true";
}

function enforcementMode(): "observe" | "enforce" {
	return process.env.AIRA_SAFETY_GATEWAY_MODE === "enforce" ? "enforce" : "observe";
}

function endpoint(): URL | null {
	const raw = process.env.AIRA_SAFETY_GATEWAY_URL?.trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
		if (!["https:", "http:"].includes(url.protocol)) return null;
		url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/evaluate`;
		return url;
	} catch {
		return null;
	}
}

function normalizeAction(value: unknown): SafetyAction {
	return value === "block" || value === "review" ? value : "allow";
}

export async function evaluateSafety(direction: SafetyDirection, text: string): Promise<SafetyDecision> {
	if (!enabled()) return { action: "allow", categories: [], degraded: false };
	const url = endpoint();
	const token = process.env.AIRA_SAFETY_GATEWAY_TOKEN?.trim();
	if (!url || !token) {
		if (required()) throw new SafetyGatewayError("Required safety gateway is not configured.");
		return { action: "allow", categories: [], degraded: true };
	}
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${token}`,
			},
			body: JSON.stringify({ direction, text: text.slice(0, 24_000) }),
			cache: "no-store",
			signal: AbortSignal.timeout(Math.min(Math.max(Number(process.env.AIRA_SAFETY_GATEWAY_TIMEOUT_MS ?? 1200), 250), 5000)),
		});
		if (!response.ok) throw new SafetyGatewayError(`Safety gateway returned HTTP ${response.status}.`);
		const payload = (await response.json()) as { action?: unknown; categories?: unknown };
		const categories = Array.isArray(payload.categories)
			? payload.categories.filter((value): value is string => typeof value === "string").slice(0, 12)
			: [];
		return { action: normalizeAction(payload.action), categories, degraded: false };
	} catch (error) {
		if (required()) throw error instanceof Error ? error : new SafetyGatewayError("Safety gateway failed.");
		return { action: "allow", categories: [], degraded: true };
	}
}

export async function assertSafetyAllowed(direction: SafetyDirection, text: string): Promise<SafetyDecision> {
	const decision = await evaluateSafety(direction, text);
	if (enforcementMode() === "enforce" && decision.action === "block") {
		throw new SafetyBlockedError(direction);
	}
	return decision;
}

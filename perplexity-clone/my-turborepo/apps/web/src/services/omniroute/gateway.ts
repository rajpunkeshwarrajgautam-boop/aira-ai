import { getOmniRouteConfigOrDisabled } from "./config";

export interface OmniRouteModel {
	readonly id: string;
	readonly ownedBy?: string;
}

export interface OmniRouteModelSnapshot {
	readonly models: readonly OmniRouteModel[];
	readonly latencyMs: number;
	readonly checkedAt: string;
	readonly version?: string;
	readonly requestId?: string;
}

type OpenAIModelList = {
	readonly data?: unknown;
};

const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 5_000;
const MAX_MODEL_ID_CHARS = 500;
const MAX_OWNER_CHARS = 200;

export class OmniRouteGatewayError extends Error {
	readonly code: string;
	readonly upstreamStatus?: number;

	constructor(code: string, message: string, upstreamStatus?: number) {
		super(message);
		this.name = "OmniRouteGatewayError";
		this.code = code;
		this.upstreamStatus = upstreamStatus;
	}
}

function safeHeader(response: Response, name: string, maxLength = 160): string | undefined {
	const value = response.headers.get(name)?.trim();
	return value ? value.slice(0, maxLength) : undefined;
}

function abortSignalWithTimeout(timeoutMs: number, externalSignal?: AbortSignal): {
	readonly signal: AbortSignal;
	readonly cleanup: () => void;
} {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
	return { signal, cleanup: () => clearTimeout(timeout) };
}

function parseModelList(raw: string): readonly OmniRouteModel[] {
	let body: OpenAIModelList;
	try {
		body = JSON.parse(raw) as OpenAIModelList;
	} catch {
		throw new OmniRouteGatewayError("OMNIROUTE_BAD_RESPONSE", "OmniRoute returned invalid model-registry JSON.");
	}
	if (!Array.isArray(body.data)) {
		throw new OmniRouteGatewayError("OMNIROUTE_BAD_RESPONSE", "OmniRoute returned an invalid model registry.");
	}

	const seen = new Set<string>();
	const models: OmniRouteModel[] = [];
	for (const value of body.data.slice(0, MAX_MODELS)) {
		if (typeof value !== "object" || value === null) continue;
		const entry = value as { readonly id?: unknown; readonly owned_by?: unknown };
		if (typeof entry.id !== "string") continue;
		const id = entry.id.trim();
		if (!id || id.length > MAX_MODEL_ID_CHARS || seen.has(id)) continue;
		seen.add(id);
		const ownedBy = typeof entry.owned_by === "string" ? entry.owned_by.trim().slice(0, MAX_OWNER_CHARS) : "";
		models.push({ id, ...(ownedBy ? { ownedBy } : {}) });
	}
	models.sort((a, b) => a.id.localeCompare(b.id));
	return models;
}

export async function fetchOmniRouteModels(externalSignal?: AbortSignal): Promise<OmniRouteModelSnapshot> {
	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		throw new OmniRouteGatewayError(
			"OMNIROUTE_NOT_CONFIGURED",
			config.configurationError ?? "OmniRoute is not configured on this AIRA deployment.",
		);
	}

	const { signal, cleanup } = abortSignalWithTimeout(config.timeoutMs, externalSignal);
	const startedAt = Date.now();
	try {
		const response = await fetch(`${config.baseURL}/models`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			cache: "no-store",
			signal,
			redirect: "error",
		});
		if (!response.ok) {
			throw new OmniRouteGatewayError(
				"OMNIROUTE_UPSTREAM_ERROR",
				`OmniRoute model discovery returned HTTP ${response.status}.`,
				response.status,
			);
		}

		const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
		if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_RESPONSE_BYTES) {
			throw new OmniRouteGatewayError("OMNIROUTE_RESPONSE_TOO_LARGE", "OmniRoute model registry exceeded the response-size limit.");
		}
		const raw = await response.text();
		if (Buffer.byteLength(raw, "utf8") > MAX_MODEL_RESPONSE_BYTES) {
			throw new OmniRouteGatewayError("OMNIROUTE_RESPONSE_TOO_LARGE", "OmniRoute model registry exceeded the response-size limit.");
		}

		return {
			models: parseModelList(raw),
			latencyMs: Date.now() - startedAt,
			checkedAt: new Date().toISOString(),
			...(safeHeader(response, "x-omniroute-version") ? { version: safeHeader(response, "x-omniroute-version") } : {}),
			...(safeHeader(response, "x-omniroute-request-id") ? { requestId: safeHeader(response, "x-omniroute-request-id") } : {}),
		};
	} catch (error) {
		if (error instanceof OmniRouteGatewayError) throw error;
		if (
			(error instanceof Error && error.name === "AbortError") ||
			externalSignal?.aborted
		) {
			throw new OmniRouteGatewayError("OMNIROUTE_TIMEOUT", `OmniRoute did not respond within ${config.timeoutMs}ms.`);
		}
		throw new OmniRouteGatewayError("OMNIROUTE_UNAVAILABLE", "OmniRoute is currently unreachable.");
	} finally {
		cleanup();
	}
}

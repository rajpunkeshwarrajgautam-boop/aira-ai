import { getOmniRouteConfigOrDisabled } from "./config";

export interface OmniRouteModel {
	readonly id: string;
	readonly ownedBy?: string;
}

export interface OmniRouteModelSnapshot {
	readonly models: readonly OmniRouteModel[];
	readonly latencyMs: number;
}

type OpenAIModelList = {
	readonly data?: readonly {
		readonly id?: unknown;
		readonly owned_by?: unknown;
	}[];
};

function publicErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message.slice(0, 320);
	return "OmniRoute request failed.";
}

export async function fetchOmniRouteModels(): Promise<OmniRouteModelSnapshot> {
	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		throw new Error("OmniRoute is not configured on this AIRA deployment.");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const startedAt = Date.now();
	try {
		const response = await fetch(`${config.baseURL}/models`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			cache: "no-store",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`OmniRoute model discovery returned HTTP ${response.status}.`);
		}

		const body = (await response.json()) as OpenAIModelList;
		const seen = new Set<string>();
		const models: OmniRouteModel[] = [];
		for (const entry of body.data ?? []) {
			if (typeof entry.id !== "string") continue;
			const id = entry.id.trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			models.push({
				id,
				...(typeof entry.owned_by === "string" && entry.owned_by.trim()
					? { ownedBy: entry.owned_by.trim() }
					: {}),
			});
		}
		models.sort((a, b) => a.id.localeCompare(b.id));
		return { models, latencyMs: Date.now() - startedAt };
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`OmniRoute did not respond within ${config.timeoutMs}ms.`);
		}
		throw new Error(publicErrorMessage(error));
	} finally {
		clearTimeout(timeout);
	}
}

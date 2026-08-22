import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	formatPublicationViolations,
	normalizeModelCitations,
	sanitizeRemainingPublicationViolations,
	validatePublicationCandidate,
} from "../publication-guard";
import {
	assertSafetyAllowed,
	postInferenceSafetyEnabled,
	SafetyBlockedError,
	SafetyGatewayError,
} from "../safety/safety-gateway";
import { getOmniRouteConfigOrDisabled } from "../omniroute/config";
import {
	getProviderHealthSnapshot,
	providerCircuitAllowsRequest,
	recordProviderFailure,
	recordProviderSuccess,
	shouldFailOverProviderError,
} from "./provider-health";
import { providerAllowedByResidency } from "./residency-policy";
import {
	ProviderRouter as CoreProviderRouter,
	type AIProvider,
	type ProviderOptions,
} from "./provider-router-core";

export type { AIProvider, ProviderOptions } from "./provider-router-core";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function systemMessageContains(
	messages: readonly ChatCompletionMessageParam[],
	needle: string,
): boolean {
	return messages.some(
		(message) =>
			message.role === "system" &&
			typeof message.content === "string" &&
			message.content.includes(needle),
	);
}

function isPrivateVerifierCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return systemMessageContains(messages, "AIRA's final answer verifier and senior editor");
}

function isPrivateStructuredJsonCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return (
		systemMessageContains(messages, "AIRA's private memory curator") ||
		systemMessageContains(messages, "AIRA's private decision-hypothesis planner")
	);
}

function enforceFinalPublicationBoundary(
	candidateInput: string,
	messages: readonly ChatCompletionMessageParam[],
): string {
	let candidate = normalizeModelCitations(candidateInput).trim();
	let violations = validatePublicationCandidate(candidate, messages);
	if (violations.length === 0) return candidate;

	candidate = sanitizeRemainingPublicationViolations(candidate, violations, messages);
	violations = validatePublicationCandidate(candidate, messages);
	if (violations.length > 0 || candidate.length < 80) {
		throw new Error(
			"AIRA publication boundary rejected unresolved verifier output: " +
				formatPublicationViolations(violations).slice(0, 1200),
		);
	}
	return candidate;
}

function isSafetyBoundaryError(error: unknown): boolean {
	return error instanceof SafetyBlockedError || error instanceof SafetyGatewayError;
}

export class ProviderRouter {
	private readonly primaryCore: CoreProviderRouter;
	private readonly fallbackCore?: CoreProviderRouter;
	private readonly registeredProviderIds = new Set<string>();
	private readonly providerDefaultModels = new Map<string, string>();

	constructor(
		private readonly primaryProviderId: string = process.env.DEFAULT_PRO_PROVIDER ?? "omniroute",
		private readonly fallbackProviderId: string = process.env.DEFAULT_FREE_PROVIDER ?? "nvidia",
	) {
		this.primaryCore = new CoreProviderRouter(primaryProviderId, primaryProviderId);
		if (fallbackProviderId !== primaryProviderId) {
			this.fallbackCore = new CoreProviderRouter(fallbackProviderId, fallbackProviderId);
		}
	}

	registerProvider(provider: AIProvider): void {
		this.registeredProviderIds.add(provider.providerId);
		this.providerDefaultModels.set(provider.providerId, provider.defaultModel);
		this.primaryCore.registerProvider(provider);
		this.fallbackCore?.registerProvider(provider);
	}

	static async createDefault(): Promise<ProviderRouter> {
		const { OpenAIProvider } = await import("./openai-provider");
		const { NVIDIAProvider } = await import("./nvidia-provider");
		const { OmniRouteProvider } = await import("./omniroute-provider");
		const router = new ProviderRouter();

		const openAiKey = process.env.OPENAI_API_KEY;
		if (openAiKey) router.registerProvider(new OpenAIProvider(openAiKey));

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) router.registerProvider(new NVIDIAProvider(nvidiaKey));

		const omniRoute = getOmniRouteConfigOrDisabled();
		if (omniRoute.configured) {
			router.registerProvider(
				new OmniRouteProvider({
					baseURL: omniRoute.baseURL,
					apiKey: omniRoute.apiKey,
					model: omniRoute.model,
				}),
			);
		}

		return router;
	}

	private providerConfigured(providerId: string): boolean {
		return this.registeredProviderIds.has(providerId) && providerAllowedByResidency(providerId);
	}

	private fallbackOptions(options: ProviderOptions): ProviderOptions {
		const fallbackModel = this.providerDefaultModels.get(this.fallbackProviderId);
		return {
			...options,
			...(fallbackModel ? { model: fallbackModel } : {}),
		};
	}

	async *streamChat(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions = {},
	): AsyncGenerator<string, void, undefined> {
		const verifierCall = isPrivateVerifierCall(messages);
		const structuredJsonCall = isPrivateStructuredJsonCall(messages);
		const privateBufferedCall = verifierCall || structuredJsonCall;
		const safetyBufferedPublication = postInferenceSafetyEnabled() && !privateBufferedCall;

		const primaryConfigured = this.providerConfigured(this.primaryProviderId);
		const fallbackConfigured =
			this.fallbackCore !== undefined && this.providerConfigured(this.fallbackProviderId);
		const primaryAllowed =
			primaryConfigured && providerCircuitAllowsRequest(this.primaryProviderId);

		let primaryError: unknown;
		if (primaryAllowed) {
			let yieldedAny = false;
			try {
				if (verifierCall) {
					let verified = "";
					for await (const delta of this.primaryCore.streamChat(messages, options)) {
						verified += delta;
					}
					const safe = enforceFinalPublicationBoundary(verified, messages);
					recordProviderSuccess(this.primaryProviderId);
					yield safe;
					return;
				}

				if (safetyBufferedPublication) {
					let candidate = "";
					for await (const delta of this.primaryCore.streamChat(messages, options)) candidate += delta;
					await assertSafetyAllowed("output", candidate);
					recordProviderSuccess(this.primaryProviderId);
					yield candidate;
					return;
				}

				for await (const delta of this.primaryCore.streamChat(messages, options)) {
					yieldedAny = true;
					yield delta;
				}
				recordProviderSuccess(this.primaryProviderId);
				return;
			} catch (error) {
				if (isSafetyBoundaryError(error)) throw error;
				primaryError = error;
				recordProviderFailure(this.primaryProviderId, error);

				if (yieldedAny) throw error;

				const canFailOver =
					fallbackConfigured &&
					(privateBufferedCall || shouldFailOverProviderError(error));
				if (!canFailOver) throw error;

				console.warn(
					"[ProviderRouter] Primary provider failed before publication; using isolated fallback.",
					JSON.stringify({
						primary: this.primaryProviderId,
						fallback: this.fallbackProviderId,
						privateCall: privateBufferedCall,
						error: errorMessage(error).slice(0, 240),
					}),
				);
			}
		} else if (primaryConfigured) {
			const health = getProviderHealthSnapshot(this.primaryProviderId);
			console.warn(
				"[ProviderRouter] Primary provider circuit is open; routing to fallback.",
				JSON.stringify({
					provider: this.primaryProviderId,
					retryAfterMs: health.retryAfterMs,
				}),
			);
		}

		if (!fallbackConfigured || !this.fallbackCore) {
			if (primaryError) throw primaryError;
			if (!primaryConfigured) {
				throw new Error("No AI providers configured or allowed by the active residency policy in ProviderRouter.");
			}
			throw new Error("Primary provider is temporarily unavailable and no permitted fallback is configured.");
		}

		if (!providerCircuitAllowsRequest(this.fallbackProviderId)) {
			const health = getProviderHealthSnapshot(this.fallbackProviderId);
			throw new Error(
				`Fallback provider is temporarily unavailable (retry after ${health.retryAfterMs}ms).`,
			);
		}

		const fallbackOptions = this.fallbackOptions(options);
		try {
			if (verifierCall) {
				let verified = "";
				for await (const delta of this.fallbackCore.streamChat(messages, fallbackOptions)) {
					verified += delta;
				}
				const safe = enforceFinalPublicationBoundary(verified, messages);
				recordProviderSuccess(this.fallbackProviderId);
				yield safe;
				return;
			}

			if (safetyBufferedPublication) {
				let candidate = "";
				for await (const delta of this.fallbackCore.streamChat(messages, fallbackOptions)) candidate += delta;
				await assertSafetyAllowed("output", candidate);
				recordProviderSuccess(this.fallbackProviderId);
				yield candidate;
				return;
			}

			for await (const delta of this.fallbackCore.streamChat(messages, fallbackOptions)) {
				yield delta;
			}
			recordProviderSuccess(this.fallbackProviderId);
		} catch (error) {
			if (isSafetyBoundaryError(error)) throw error;
			recordProviderFailure(this.fallbackProviderId, error);
			throw error;
		}
	}
}

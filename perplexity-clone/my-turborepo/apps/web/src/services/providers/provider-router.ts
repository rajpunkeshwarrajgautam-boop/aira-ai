import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	formatPublicationViolations,
	normalizeModelCitations,
	sanitizeRemainingPublicationViolations,
	validatePublicationCandidate,
} from "../publication-guard";
import {
	getProviderHealthSnapshot,
	providerCircuitAllowsRequest,
	recordProviderFailure,
	recordProviderSuccess,
	shouldFailOverProviderError,
} from "./provider-health";
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

/**
 * Independent publication boundary outside the legacy/core verifier implementation.
 * If deterministic issues survive the core verifier and its repair pass, sanitize the
 * machine-detectable failures and validate once more. Anything still failing is rejected
 * rather than published.
 */
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

/**
 * Resilience facade around the proven ProviderRouter core.
 *
 * The core remains responsible for model-specific streaming, private verifier recovery,
 * and structured-output recovery. This facade owns provider health, circuit breaking,
 * safe cross-provider failover, and a second fail-closed publication boundary.
 */
export class ProviderRouter {
	private readonly primaryCore: CoreProviderRouter;
	private readonly fallbackCore?: CoreProviderRouter;
	private readonly registeredProviderIds = new Set<string>();
	private readonly providerDefaultModels = new Map<string, string>();

	constructor(
		private readonly primaryProviderId: string = process.env.DEFAULT_PRO_PROVIDER ?? "openai",
		private readonly fallbackProviderId: string = process.env.DEFAULT_FREE_PROVIDER ?? "nvidia",
	) {
		// Each core is deliberately single-provider. The facade owns cross-provider failover,
		// which prevents partial streams from being concatenated across providers.
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
		const router = new ProviderRouter();

		const openAiKey = process.env.OPENAI_API_KEY;
		if (openAiKey) router.registerProvider(new OpenAIProvider(openAiKey));

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) router.registerProvider(new NVIDIAProvider(nvidiaKey));

		return router;
	}

	private providerConfigured(providerId: string): boolean {
		return this.registeredProviderIds.has(providerId);
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

				for await (const delta of this.primaryCore.streamChat(messages, options)) {
					yieldedAny = true;
					yield delta;
				}
				recordProviderSuccess(this.primaryProviderId);
				return;
			} catch (error) {
				primaryError = error;
				recordProviderFailure(this.primaryProviderId, error);

				// Once user-visible streaming has begun, switching providers would concatenate
				// unrelated answers. Fail the stream instead of corrupting it.
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
			if (!primaryConfigured) throw new Error("No AI providers configured in ProviderRouter.");
			throw new Error("Primary provider is temporarily unavailable and no fallback is configured.");
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

			for await (const delta of this.fallbackCore.streamChat(messages, fallbackOptions)) {
				yield delta;
			}
			recordProviderSuccess(this.fallbackProviderId);
		} catch (error) {
			recordProviderFailure(this.fallbackProviderId, error);
			throw error;
		}
	}
}

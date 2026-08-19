import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface ProviderOptions {
	readonly model?: string;
	readonly temperature?: number;
	readonly maxCompletionTokens?: number;
	readonly abortSignal?: AbortSignal;
	readonly topP?: number;
	readonly frequencyPenalty?: number;
	readonly presencePenalty?: number;
}

export interface AIProvider {
	readonly providerId: string;
	readonly defaultModel: string;
	generateTextStream(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	): AsyncGenerator<string, void, undefined>;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function errorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function isPrivateVerifierCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return messages.some((message) => {
		if (message.role !== "system" || typeof message.content !== "string") return false;
		return message.content.includes("AIRA's final answer verifier and senior editor");
	});
}

function looksLikePrivateAuditLeak(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	if (!normalized) return false;

	const hardLeakPhrases = [
		"we need to verify and repair the draft",
		"the user wants us to return only the corrected final answer",
		"must preserve citation",
		"let's check each claim",
		"now let's craft the answer",
		"we need to produce a corrected final answer",
		"the instruction says",
		"draft to verify and repair",
		"the draft includes citations",
		"we need to ensure every claim",
		"we must also ensure",
	];
	if (hardLeakPhrases.some((phrase) => normalized.includes(phrase))) return true;

	const auditMarkers = [
		"we need to",
		"we must",
		"the user wants",
		"the draft",
		"the instruction",
		"must not",
		"need to ensure",
		"let's draft",
		"let's craft",
		"we should remove",
		"we should correct",
	];
	const markerHits = auditMarkers.filter((marker) => normalized.includes(marker)).length;
	return markerHits >= 3;
}

function extractVerifierFinalEnvelope(text: string): string | null {
	const open = "<aira_final>";
	const close = "</aira_final>";
	const start = text.lastIndexOf(open);
	if (start < 0) return null;
	const contentStart = start + open.length;
	const end = text.indexOf(close, contentStart);
	if (end < 0) return null;
	const finalText = text.slice(contentStart, end).trim();
	if (finalText.length < 80 || looksLikePrivateAuditLeak(finalText)) return null;
	return finalText;
}

async function collectProviderText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	options: ProviderOptions,
): Promise<string> {
	let text = "";
	for await (const delta of provider.generateTextStream(messages, options)) {
		text += delta;
	}
	return text;
}

async function generateSafeVerifierText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	options: ProviderOptions,
): Promise<string> {
	const verifierOptions: ProviderOptions = {
		...options,
		temperature: 0,
		maxCompletionTokens: Math.max(options.maxCompletionTokens ?? 0, 4800),
	};
	const first = await collectProviderText(provider, messages, verifierOptions);
	const firstEnvelope = extractVerifierFinalEnvelope(first);
	if (firstEnvelope) return firstEnvelope;

	const firstTrimmed = first.trim();
	if (firstTrimmed.length >= 120 && !looksLikePrivateAuditLeak(firstTrimmed)) {
		return firstTrimmed;
	}

	console.warn("[ProviderRouter] Private verifier emitted audit-style or incomplete output; retrying with a final-answer envelope.");
	const retryMessages: ChatCompletionMessageParam[] = [
		...messages,
		{
			role: "user",
			content:
				"Your previous verifier response was rejected because it contained audit/reasoning text or did not provide a complete user-facing answer. Retry the SAME verification task now. Return exactly one wrapper <aira_final> followed by the complete corrected answer for the user and then </aira_final>. Put absolutely no text, analysis, audit notes, preface, or explanation outside that wrapper. Preserve only valid citation markers from the supplied evidence.",
		},
	];
	const retry = await collectProviderText(provider, retryMessages, {
		...verifierOptions,
		maxCompletionTokens: Math.max(verifierOptions.maxCompletionTokens ?? 0, 5600),
	});
	const recovered = extractVerifierFinalEnvelope(retry);
	if (!recovered) {
		throw new Error("Private verifier failed to produce a safe final-answer envelope.");
	}
	return recovered;
}

export class ProviderRouter {
	private readonly providers: Map<string, AIProvider> = new Map();

	constructor(
		private readonly primaryProviderId: string = process.env.DEFAULT_PRO_PROVIDER ?? "openai",
		private readonly fallbackProviderId: string = process.env.DEFAULT_FREE_PROVIDER ?? "nvidia",
	) {}

	registerProvider(provider: AIProvider) {
		this.providers.set(provider.providerId, provider);
	}

	static async createDefault(): Promise<ProviderRouter> {
		const { OpenAIProvider } = await import("./openai-provider");
		const { NVIDIAProvider } = await import("./nvidia-provider");

		const router = new ProviderRouter();

		const openAiKey = process.env.OPENAI_API_KEY;
		if (openAiKey) {
			router.registerProvider(new OpenAIProvider(openAiKey));
		}

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) {
			router.registerProvider(new NVIDIAProvider(nvidiaKey));
		}

		return router;
	}

	async *streamChat(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions = {},
	): AsyncGenerator<string, void, undefined> {
		const primary = this.providers.get(this.primaryProviderId);
		const fallback =
			this.fallbackProviderId === this.primaryProviderId
				? undefined
				: this.providers.get(this.fallbackProviderId);

		if (!primary && !fallback) {
			throw new Error("No AI providers configured in ProviderRouter.");
		}

		const verifierCall = isPrivateVerifierCall(messages);
		let useFallback = !primary;

		if (primary) {
			try {
				if (verifierCall) {
					const verifiedText = await generateSafeVerifierText(primary, messages, options);
					if (verifiedText) yield verifiedText;
				} else {
					yield* primary.generateTextStream(messages, options);
				}
				return; // Success, exit
			} catch (error: unknown) {
				const errorStr = errorMessage(error).toLowerCase();
				const isQuotaError =
					errorStr.includes("insufficient_quota") ||
					errorStr.includes("429") ||
					errorStatus(error) === 429 ||
					errorStr.includes("limit_reached");

				if ((verifierCall || isQuotaError) && fallback) {
					console.warn(
						verifierCall
							? `[ProviderRouter] Primary verifier (${this.primaryProviderId}) failed safely. Falling back to ${this.fallbackProviderId}.`
							: `[ProviderRouter] Primary provider (${this.primaryProviderId}) quota exceeded. Falling back to ${this.fallbackProviderId}.`,
					);
					useFallback = true;
				} else {
					throw error;
				}
			}
		}

		if (useFallback && fallback) {
			// A fallback provider cannot safely reuse a model identifier from the
			// primary provider. Always use the fallback provider's configured model.
			const fallbackOptions: ProviderOptions = {
				...options,
				model: fallback.defaultModel,
			};
			if (verifierCall) {
				const verifiedText = await generateSafeVerifierText(fallback, messages, fallbackOptions);
				if (verifiedText) yield verifiedText;
			} else {
				yield* fallback.generateTextStream(messages, fallbackOptions);
			}
		} else if (useFallback) {
			throw new Error("Primary provider failed and no fallback is available.");
		}
	}
}

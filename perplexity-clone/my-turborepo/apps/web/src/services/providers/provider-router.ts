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
		const fallback = this.providers.get(this.fallbackProviderId);

		if (!primary && !fallback) {
			throw new Error("No AI providers configured in ProviderRouter.");
		}

		let useFallback = !primary;

		if (primary) {
			try {
				yield* primary.generateTextStream(messages, options);
				return; // Success, exit
				} catch (error: unknown) {
					const errorStr = errorMessage(error).toLowerCase();
					const isQuotaError =
						errorStr.includes("insufficient_quota") ||
						errorStr.includes("429") ||
						errorStatus(error) === 429 ||
					errorStr.includes("limit_reached");

				if (isQuotaError && fallback) {
					console.warn(
						`[ProviderRouter] Primary provider (${this.primaryProviderId}) quota exceeded. Falling back to ${this.fallbackProviderId}.`,
					);
					useFallback = true;
				} else {
					throw error;
				}
			}
		}

		if (useFallback && fallback) {
			yield* fallback.generateTextStream(messages, options);
		} else if (useFallback) {
			throw new Error("Primary provider failed and no fallback is available.");
		}
	}
}

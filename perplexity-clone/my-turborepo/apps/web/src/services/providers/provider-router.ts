import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";

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

export class OpenAIProvider implements AIProvider {
	readonly providerId = "openai";
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		readonly defaultModel: string = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
		baseURL?: string,
		organization?: string,
	) {
		this.client = new OpenAI({ apiKey, baseURL, organization });
	}

	async *generateTextStream(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	): AsyncGenerator<string, void, undefined> {
		const params: ChatCompletionCreateParamsStreaming = {
			model: options.model ?? this.defaultModel,
			messages,
			stream: true,
			temperature: options.temperature,
			max_completion_tokens: options.maxCompletionTokens,
			top_p: options.topP,
			frequency_penalty: options.frequencyPenalty,
			presence_penalty: options.presencePenalty,
		};

		const stream = await this.client.chat.completions.create(params, {
			signal: options.abortSignal,
		});

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			const text = delta?.content;
			if (text) yield text;
			const refusal = delta?.refusal;
			if (refusal) yield refusal;
		}
	}
}

export class NVIDIAProvider implements AIProvider {
	readonly providerId = "nvidia";
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		readonly defaultModel: string = process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-8b-instruct",
	) {
		this.client = new OpenAI({
			apiKey,
			baseURL: "https://integrate.api.nvidia.com/v1",
		});
	}

	async *generateTextStream(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	): AsyncGenerator<string, void, undefined> {
		const params: ChatCompletionCreateParamsStreaming = {
			model: options.model ?? this.defaultModel,
			messages,
			stream: true,
			temperature: options.temperature,
			max_completion_tokens: options.maxCompletionTokens,
			top_p: options.topP,
			frequency_penalty: options.frequencyPenalty,
			presence_penalty: options.presencePenalty,
		};

		const stream = await this.client.chat.completions.create(params, {
			signal: options.abortSignal,
		});

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			const text = delta?.content;
			if (text) yield text;
			const refusal = delta?.refusal;
			if (refusal) yield refusal;
		}
	}
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
			} catch (error: any) {
				const errorStr = String(error?.message || error).toLowerCase();
				const isQuotaError =
					errorStr.includes("insufficient_quota") ||
					errorStr.includes("429") ||
					error?.status === 429 ||
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

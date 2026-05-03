import type {
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
	OpenAIProvider,
	NVIDIAProvider,
	ProviderRouter,
	type ProviderOptions,
} from "./providers/provider-router";

export interface OpenAIServiceConfig {
	readonly apiKey?: string;
	readonly organization?: string;
	readonly baseURL?: string;
	/** Default chat model when callers omit `model` (e.g. gpt-4o-mini). */
	readonly defaultModel: string;
	readonly defaultTemperature: number;
	readonly defaultMaxCompletionTokens: number;
}

export const DEFAULT_OPENAI_CONFIG: OpenAIServiceConfig = {
	defaultModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
	defaultTemperature: 0.2,
	defaultMaxCompletionTokens: 2048,
};

function getApiKey(explicit?: string): string | undefined {
	return explicit ?? process.env.OPENAI_API_KEY;
}

export class OpenAIService {
	private readonly router: ProviderRouter;
	readonly config: OpenAIServiceConfig;

	constructor(config: Partial<OpenAIServiceConfig> = {}) {
		const merged: OpenAIServiceConfig = { ...DEFAULT_OPENAI_CONFIG, ...config };
		this.config = merged;

		this.router = new ProviderRouter();

		const openAiKey = getApiKey(merged.apiKey);
		if (openAiKey) {
			this.router.registerProvider(
				new OpenAIProvider(
					openAiKey,
					merged.defaultModel,
					merged.baseURL,
					merged.organization,
				),
			);
		}

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) {
			this.router.registerProvider(new NVIDIAProvider(nvidiaKey));
		}
	}

	/**
	 * Low-level streaming chat completion. Yields assistant text deltas only.
	 */
	async *streamChatText(
		messages: ChatCompletionMessageParam[],
		options: {
			model?: string;
			temperature?: number;
			maxCompletionTokens?: number;
			abortSignal?: AbortSignal;
			topP?: number;
			frequencyPenalty?: number;
			presencePenalty?: number;
		} = {},
	): AsyncGenerator<string, void, undefined> {
		const routerOptions: ProviderOptions = {
			model: options.model ?? this.config.defaultModel,
			temperature: options.temperature ?? this.config.defaultTemperature,
			maxCompletionTokens:
				options.maxCompletionTokens ?? this.config.defaultMaxCompletionTokens,
			abortSignal: options.abortSignal,
			topP: options.topP,
			frequencyPenalty: options.frequencyPenalty,
			presencePenalty: options.presencePenalty,
		};

		yield* this.router.streamChat(messages, routerOptions);
	}

	/**
	 * Collect a full assistant string from a text stream (utility for non-SSE callers).
	 */
	static async collectTextStream(stream: AsyncIterable<string>): Promise<string> {
		let out = "";
		for await (const part of stream) {
			out += part;
		}
		return out;
	}
}

let shared: OpenAIService | undefined;

export function getOpenAIService(config?: Partial<OpenAIServiceConfig>): OpenAIService {
	if (!shared) {
		shared = new OpenAIService(config);
	} else if (config && Object.keys(config).length > 0) {
		shared = new OpenAIService({ ...shared.config, ...config });
	}
	return shared;
}

export function createOpenAIService(config?: Partial<OpenAIServiceConfig>): OpenAIService {
	return new OpenAIService(config);
}


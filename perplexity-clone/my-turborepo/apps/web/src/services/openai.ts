import type {
	ChatCompletionMessageParam,
	ChatCompletionMessage,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import {
	ProviderRouter,
	type ProviderOptions,
} from "./providers/provider-router";
import { OpenAIProvider } from "./providers/openai-provider";
import { NVIDIAProvider } from "./providers/nvidia-provider";

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
			// Let each provider use its own configured default model unless the
			// caller explicitly requests one. Passing the OpenAI default here made
			// quota failover send `gpt-4o-mini` to NVIDIA.
			...(options.model !== undefined ? { model: options.model } : {}),
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
	 * Checks if the service has an active provider capable of native tool calling for the given model.
	 */
	supportsNativeToolCalling(model?: string): boolean {
		if (model && (model.startsWith("meta/") || model.startsWith("nvidia/"))) {
			return false;
		}
		const openAiProvider = this.router.getProvider("openai") as OpenAIProvider | undefined;
		return Boolean(openAiProvider && typeof openAiProvider.generateChatCompletion === "function");
	}

	/**
	 * Non-streaming chat completion with optional native tools support.
	 */
	async chatCompletion(
		messages: ChatCompletionMessageParam[],
		options: {
			model?: string;
			temperature?: number;
			maxCompletionTokens?: number;
			abortSignal?: AbortSignal;
			topP?: number;
			frequencyPenalty?: number;
			presencePenalty?: number;
			tools?: ChatCompletionTool[];
			toolChoice?: ChatCompletionToolChoiceOption;
		} = {},
	): Promise<ChatCompletionMessage> {
		if (options.model && (options.model.startsWith("meta/") || options.model.startsWith("nvidia/"))) {
			throw new Error("Provider 'nvidia' does not support native tool calling. Refusing to route free-tier model to paid provider.");
		}
		const openAiProvider = this.router.getProvider("openai") as OpenAIProvider | undefined;
		if (openAiProvider && typeof openAiProvider.generateChatCompletion === "function") {
			return openAiProvider.generateChatCompletion(messages, {
				model: options.model,
				temperature: options.temperature ?? this.config.defaultTemperature,
				maxCompletionTokens: options.maxCompletionTokens ?? this.config.defaultMaxCompletionTokens,
				abortSignal: options.abortSignal,
				topP: options.topP,
				frequencyPenalty: options.frequencyPenalty,
				presencePenalty: options.presencePenalty,
				tools: options.tools,
				toolChoice: options.toolChoice,
			});
		}
		throw new Error("No native-tool-capable provider is configured in OpenAIService.");
	}

	/**
	 * Returns true if the service has at least one active, residency-allowed provider route.
	 */
	hasConfiguredRoute(): boolean {
		return this.router.hasConfiguredRoute();
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

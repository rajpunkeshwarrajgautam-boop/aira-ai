import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";

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

function requireApiKey(explicit?: string): string | undefined {
	const key = explicit ?? process.env.OPENAI_API_KEY;
	return key;
}

export class OpenAIService {
	readonly client?: OpenAI;
	readonly nvidiaClient?: OpenAI;
	readonly config: OpenAIServiceConfig;

	constructor(config: Partial<OpenAIServiceConfig> = {}) {
		const merged: OpenAIServiceConfig = { ...DEFAULT_OPENAI_CONFIG, ...config };
		this.config = merged;
		
		const openAiKey = requireApiKey(merged.apiKey);
		if (openAiKey) {
			this.client = new OpenAI({
				apiKey: openAiKey,
				organization: merged.organization,
				baseURL: merged.baseURL,
			});
		}

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) {
			this.nvidiaClient = new OpenAI({
				baseURL: "https://integrate.api.nvidia.com/v1",
				apiKey: nvidiaKey,
			});
		}

		if (!this.client && !this.nvidiaClient) {
			throw new Error("No API key provided. Set OPENAI_API_KEY or NVIDIA_API_KEY.");
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
		const params: ChatCompletionCreateParamsStreaming = {
			model: options.model ?? this.config.defaultModel,
			messages,
			stream: true,
			temperature: options.temperature ?? this.config.defaultTemperature,
			max_completion_tokens:
				options.maxCompletionTokens ?? this.config.defaultMaxCompletionTokens,
			top_p: options.topP,
			frequency_penalty: options.frequencyPenalty,
			presence_penalty: options.presencePenalty,
		};

		let stream;
		let useNvidia = !this.client; // fallback if OpenAI is missing

		if (!useNvidia && this.client) {
			try {
				stream = await this.client.chat.completions.create(params, {
					signal: options.abortSignal,
				});
			} catch (error: any) {
				const errorStr = String(error?.message || error).toLowerCase();
				if (
					errorStr.includes("insufficient_quota") ||
					errorStr.includes("429") ||
					error?.status === 429
				) {
					console.warn("[OpenAIService] Quota exceeded or 429. Falling back to NVIDIA API.");
					useNvidia = true;
				} else {
					throw error;
				}
			}
		}

		if (useNvidia) {
			if (!this.nvidiaClient) {
				throw new Error("OpenAI quota exceeded/missing, and NVIDIA_API_KEY is not set for fallback.");
			}
			const nvidiaParams = {
				...params,
				model: "moonshotai/kimi-k2.5", // User requested fallback model
			};
			stream = await this.nvidiaClient.chat.completions.create(nvidiaParams, {
				signal: options.abortSignal,
			});
		}

		if (!stream) {
			throw new Error("Failed to initialize completion stream.");
		}

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			const text = delta?.content;
			if (text) yield text;
			const refusal = delta?.refusal;
			if (refusal) yield refusal;
		}
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

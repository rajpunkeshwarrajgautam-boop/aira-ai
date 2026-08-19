import OpenAI from "openai";
import type {
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import type { AIProvider, ProviderOptions } from "./provider-router";

export class SelfHostedProvider implements AIProvider {
	readonly providerId = "self-hosted";
	readonly defaultModel: string;
	private readonly client: OpenAI;

	constructor(args: { readonly apiKey: string; readonly baseURL: string; readonly model: string }) {
		this.defaultModel = args.model;
		this.client = new OpenAI({ apiKey: args.apiKey, baseURL: args.baseURL.replace(/\/$/, "") });
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
			if (delta?.content) yield delta.content;
			if (delta?.refusal) yield delta.refusal;
		}
	}
}

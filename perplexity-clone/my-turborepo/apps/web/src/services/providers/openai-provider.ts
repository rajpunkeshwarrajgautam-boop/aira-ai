import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { AIProvider, ProviderOptions } from "./provider-router";

export class OpenAIProvider implements AIProvider {
	readonly providerId = "openai";
	readonly defaultModel: string;
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		defaultModel: string = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
		baseURL?: string,
		organization?: string,
	) {
		this.defaultModel = defaultModel;
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

	async generateChatCompletion(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions & {
			tools?: OpenAI.ChatCompletionTool[];
			toolChoice?: OpenAI.ChatCompletionToolChoiceOption;
		} = {},
	): Promise<OpenAI.ChatCompletionMessage> {
		const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
			model: options.model ?? this.defaultModel,
			messages,
			stream: false,
			temperature: options.temperature,
			max_completion_tokens: options.maxCompletionTokens,
			top_p: options.topP,
			frequency_penalty: options.frequencyPenalty,
			presence_penalty: options.presencePenalty,
			...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
			...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
		};

		const response = await this.client.chat.completions.create(params, {
			signal: options.abortSignal,
		});

		const choice = response.choices[0];
		if (!choice?.message) {
			throw new Error("OpenAI provider returned an empty completion choice.");
		}
		return choice.message;
	}
}

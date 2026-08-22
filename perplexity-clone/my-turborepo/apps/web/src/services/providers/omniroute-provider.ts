import OpenAI from "openai";
import type {
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import { getOmniRouteConfigOrDisabled } from "../omniroute/config";
import type { AIProvider, ProviderOptions } from "./provider-router";

/**
 * OmniRoute exposes an OpenAI-compatible /v1 gateway. Keeping it behind the
 * AIRA provider interface means AIRA's safety, publication, residency and
 * circuit-breaker layers remain authoritative while OmniRoute handles the
 * upstream provider/model fleet.
 *
 * SDK retries are intentionally disabled. OmniRoute owns model/account fallback
 * inside the gateway and AIRA owns gateway-level failover, so another hidden
 * retry layer would multiply latency and request cost.
 */
export class OmniRouteProvider implements AIProvider {
	readonly providerId = "omniroute";
	readonly defaultModel: string;
	private readonly client: OpenAI;

	constructor(args: {
		readonly baseURL: string;
		readonly apiKey: string;
		readonly model?: string;
		readonly timeoutMs?: number;
	}) {
		this.defaultModel = args.model?.trim() || "auto";
		const timeoutMs = args.timeoutMs ?? getOmniRouteConfigOrDisabled().timeoutMs;
		this.client = new OpenAI({
			apiKey: args.apiKey.trim(),
			baseURL: args.baseURL.replace(/\/$/, ""),
			timeout: timeoutMs,
			maxRetries: 0,
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
			if (typeof delta?.content === "string" && delta.content) yield delta.content;
			if (typeof delta?.refusal === "string" && delta.refusal) yield delta.refusal;
		}
	}
}

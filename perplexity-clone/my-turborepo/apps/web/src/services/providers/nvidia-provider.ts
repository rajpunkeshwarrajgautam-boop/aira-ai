import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { AIProvider, ProviderOptions } from "./provider-router";

/**
 * The model NVIDIA actually serves by default. Exported so that surfaces which
 * must *name* the model before calling it (provider pickers, status readouts)
 * cannot drift from the model the provider will really use.
 */
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-nano-30b-a3b";
const DEFAULT_NVIDIA_FALLBACK_MODELS = [
	"meta/llama-3.3-70b-instruct",
	"minimaxai/minimax-m3",
] as const;

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}

	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function isModelAccessError(error: unknown): boolean {
	const status = getErrorStatus(error);
	if (status === 403 || status === 404) return true;

	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes("forbidden") ||
		message.includes("permission") ||
		message.includes("model_not_found") ||
		message.includes("unknown model") ||
		message.includes("model does not exist")
	);
}

function configuredFallbackModels(): readonly string[] {
	const configured = process.env.NVIDIA_CHAT_MODEL_FALLBACKS
		?.split(",")
		.map((model) => model.trim())
		.filter(Boolean);

	return configured?.length ? configured : DEFAULT_NVIDIA_FALLBACK_MODELS;
}

export class NVIDIAProvider implements AIProvider {
	readonly providerId = "nvidia";
	readonly defaultModel: string;
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		defaultModel: string = process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL,
	) {
		this.defaultModel = defaultModel;
		this.client = new OpenAI({
			apiKey,
			baseURL: "https://integrate.api.nvidia.com/v1",
		});
	}

	async *generateTextStream(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	): AsyncGenerator<string, void, undefined> {
		const requestedModel = options.model ?? this.defaultModel;
		const models = [requestedModel, ...configuredFallbackModels()].filter(
			(model, index, all) => all.indexOf(model) === index,
		);

		for (const [index, model] of models.entries()) {
			let emittedText = false;

			try {
				const params: ChatCompletionCreateParamsStreaming = {
					model,
					messages,
					stream: true,
					temperature: options.temperature,
					max_tokens: options.maxCompletionTokens,
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
					if (text) {
						emittedText = true;
						yield text;
					}
					const refusal = delta?.refusal;
					if (refusal) {
						emittedText = true;
						yield refusal;
					}
				}

				return;
			} catch (error) {
				const hasAnotherModel = index < models.length - 1;
				if (emittedText || !hasAnotherModel || !isModelAccessError(error)) {
					throw error;
				}

				console.warn(
					`[NVIDIAProvider] Model ${model} is unavailable (status ${getErrorStatus(error) ?? "unknown"}). Trying the next configured model.`,
				);
			}
		}

		throw new Error("No accessible NVIDIA chat model is available.");
	}
}

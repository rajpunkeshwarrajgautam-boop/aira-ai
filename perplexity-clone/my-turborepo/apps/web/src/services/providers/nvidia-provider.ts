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
export const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";
const DEFAULT_NVIDIA_FALLBACK_MODELS: readonly string[] = [
	"nvidia/nemotron-3-super-120b-a12b",
	"openai/gpt-oss-20b",
	"meta/muse-glimmer-30b",
];

function isRetiredNvidiaModel(model: string): boolean {
	return (
		model === "meta/llama-3.3-70b-instruct" ||
		model === "meta/llama-3.1-70b-instruct" ||
		model === "meta/llama-3.1-8b-instruct" ||
		model === "meta/llama-3.2-3b-instruct" ||
		model.includes("nemotron-3-nano")
	);
}

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}

	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function isModelAccessError(error: unknown): boolean {
	const status = getErrorStatus(error);
	if (status === 403 || status === 404 || status === 410) return true;

	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes("forbidden") ||
		message.includes("permission") ||
		message.includes("model_not_found") ||
		message.includes("unknown model") ||
		message.includes("model does not exist") ||
		message.includes("not found") ||
		message.includes("gone") ||
		message.includes("no longer available") ||
		message.includes("end of life")
	);
}

function configuredFallbackModels(): readonly string[] {
	const configured = process.env.NVIDIA_CHAT_MODEL_FALLBACKS
		?.split(",")
		.map((model) => model.trim())
		.filter((model) => Boolean(model) && !isRetiredNvidiaModel(model));

	const list = configured?.length ? configured : DEFAULT_NVIDIA_FALLBACK_MODELS;
	if (!list.includes(DEFAULT_NVIDIA_MODEL)) {
		return [...list, DEFAULT_NVIDIA_MODEL];
	}
	return list;
}

export class NVIDIAProvider implements AIProvider {
	readonly providerId = "nvidia";
	readonly defaultModel: string;
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		defaultModel: string = process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL,
	) {
		this.defaultModel = isRetiredNvidiaModel(defaultModel)
			? DEFAULT_NVIDIA_MODEL
			: defaultModel;
		this.client = new OpenAI({
			apiKey,
			baseURL: "https://integrate.api.nvidia.com/v1",
			timeout: 30000,
		});
	}

	async *generateTextStream(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	): AsyncGenerator<string, void, undefined> {
		const rawRequested = options.model ?? this.defaultModel;
		const requestedModel = isRetiredNvidiaModel(rawRequested)
			? DEFAULT_NVIDIA_MODEL
			: rawRequested;
		const models = [requestedModel, ...configuredFallbackModels(), DEFAULT_NVIDIA_MODEL].filter(
			(model, index, all) => all.indexOf(model) === index,
		);

		let lastError: unknown;

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
				lastError = error;
				const hasAnotherModel = index < models.length - 1;
				if (emittedText || !hasAnotherModel || !isModelAccessError(error)) {
					throw error;
				}

				console.warn(
					`[NVIDIAProvider] Model ${model} is unavailable (status ${getErrorStatus(error) ?? "unknown"}). Trying the next configured model.`,
				);
			}
		}

		const exhaustionError = new Error("No accessible NVIDIA chat model is available.");
		Object.assign(exhaustionError, {
			status: getErrorStatus(lastError) ?? 410,
			code: "MODEL_UNAVAILABLE",
			cause: lastError,
		});
		throw exhaustionError;
	}
}

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
	if (typeof error !== "object" || error === null) return undefined;
	const obj = error as Record<string, unknown>;
	if (typeof obj.status === "number") return obj.status;
	if (typeof obj.code === "number") return obj.code;
	if (typeof obj.error === "object" && obj.error !== null) {
		const sub = obj.error as Record<string, unknown>;
		if (typeof sub.code === "number") return sub.code;
		if (typeof sub.status === "number") return sub.status;
	}
	return undefined;
}

function isRetryableModelError(error: unknown): boolean {
	const status = getErrorStatus(error);
	if (
		status === 403 ||
		status === 404 ||
		status === 410 ||
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	) {
		return true;
	}

	const message = error instanceof Error ? error.message.toLowerCase() : "";
	return (
		message.includes("410") ||
		message.includes("404") ||
		message.includes("429") ||
		message.includes("503") ||
		message.includes("overload") ||
		message.includes("busy") ||
		message.includes("rate limit") ||
		message.includes("temporarily") ||
		message.includes("model") ||
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
		const rawRequested =
			options.model && options.model !== "auto" && options.model !== "default"
				? options.model
				: this.defaultModel;
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
				if (emittedText || !isRetryableModelError(error)) {
					throw error;
				}

				if (hasAnotherModel) {
					console.warn(
						`[NVIDIAProvider] Model ${model} is unavailable (status ${getErrorStatus(error) ?? "unknown"}). Trying the next configured model.`,
					);
				}
			}
		}

		const exhaustionError = new Error(
			"No accessible NVIDIA chat model is available: " +
				(lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")),
		);
		Object.assign(exhaustionError, {
			status: getErrorStatus(lastError) ?? 410,
			code: "MODEL_UNAVAILABLE",
			cause: lastError,
		});
		throw exhaustionError;
	}
}

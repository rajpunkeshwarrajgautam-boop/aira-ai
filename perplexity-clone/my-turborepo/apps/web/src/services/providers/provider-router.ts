import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function errorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function isPrivateVerifierCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return messages.some((message) => {
		if (message.role !== "system" || typeof message.content !== "string") return false;
		return message.content.includes("AIRA's final answer verifier and senior editor");
	});
}

function looksLikePrivateAuditLeak(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	if (!normalized) return false;

	const hardLeakPhrases = [
		"we need to verify and repair the draft",
		"the user wants us to return only the corrected final answer",
		"must preserve citation",
		"let's check each claim",
		"now let's craft the answer",
		"we need to produce a corrected final answer",
		"the instruction says",
		"draft to verify and repair",
		"the draft includes citations",
		"we need to ensure every claim",
		"we must also ensure",
	];
	if (hardLeakPhrases.some((phrase) => normalized.includes(phrase))) return true;

	const auditMarkers = [
		"we need to",
		"we must",
		"the user wants",
		"the draft",
		"the instruction",
		"must not",
		"need to ensure",
		"let's draft",
		"let's craft",
		"we should remove",
		"we should correct",
	];
	const markerHits = auditMarkers.filter((marker) => normalized.includes(marker)).length;
	return markerHits >= 3;
}

function extractVerifierFinalEnvelope(text: string): string | null {
	const open = "<aira_final>";
	const close = "</aira_final>";
	const start = text.lastIndexOf(open);
	if (start < 0) return null;
	const contentStart = start + open.length;
	const end = text.indexOf(close, contentStart);
	if (end < 0) return null;
	const finalText = text.slice(contentStart, end).trim();
	if (finalText.length < 80 || looksLikePrivateAuditLeak(finalText)) return null;
	return finalText;
}

async function collectProviderText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	options: ProviderOptions,
): Promise<string> {
	let text = "";
	for await (const delta of provider.generateTextStream(messages, options)) {
		text += delta;
	}
	return text;
}

async function generatePublicationSafeVerifierText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	candidate: string,
	options: ProviderOptions,
): Promise<string> {
	const publicationMessages: ChatCompletionMessageParam[] = [
		...messages,
		{
			role: "assistant",
			content: candidate,
		},
		{
			role: "user",
			content: `Run one final PRIVATE publication-quality pass on the candidate answer above. Do not explain the audit. Return exactly <aira_final> followed by the complete corrected user-facing answer and then </aira_final>, with absolutely no text outside that wrapper.

Publication gate — repair the answer if ANY item fails:
- Existing-state use: read the durable user state in the original verifier task. If it names an existing company, product, platform, infrastructure, or prior build directly relevant to the decision, explicitly use that asset in the recommendation or explicitly explain why not. Never silently answer as if the user starts from zero.
- Evidence hierarchy: respect the authoritative-source requirement and the actual authoritative-source count stated in the original verifier task. If authoritative evidence is short, do not let blogs/unknown pages carry precise decision-critical market, regulatory, or adoption claims. Downgrade, remove, or visibly qualify them.
- Arithmetic: recompute every budget total, subtotal, reserve, MRR/ARR example, customer-count multiplication, percentage, unit conversion, and timeline relationship. A fixed-budget plan must reconcile allocated spend + reserve to the stated budget. If exact arithmetic cannot be justified, use a range or remove the number.
- No TAM leap: never multiply a large market-size/TAM figure by an arbitrary market-share percentage and present that as a plausible company outcome. Use bottom-up price × customers × retention assumptions instead, or omit the revenue projection.
- Currency consistency: do not claim a USD cost range fits an INR budget unless a conversion assumption is shown and the converted range actually fits. Otherwise remove that comparison.
- Decision rigor: the winner must follow from evidence plus user fit. Do not award a winner merely because it has more retrieved pages.
- Adversarial rigor: if the user asked to argue against the recommendation, include a distinct strongest case against it AND a concrete condition/evidence threshold that would make the recommendation change.
- Avoid-list: if the user asked what to avoid, explicitly state the most important things to avoid.
- Source precision: precise customer-base counts, adoption percentages, market sizes, build costs, timelines, and willingness-to-pay claims from weak/unknown sources must be labeled estimates or removed unless corroborated.
- Citation integrity: preserve only citation numbers that exist in the supplied evidence and keep each citation attached to the exact claim it supports.
- Practicality: prefer a validation-first plan with milestones and kill criteria over speculative vanity targets. Do not spend most of a constrained budget before proving willingness to pay.

Do not output audit notes, hidden reasoning, checklists, or commentary outside the final answer wrapper.`,
		},
	];

	const text = await collectProviderText(provider, publicationMessages, {
		...options,
		temperature: 0,
		maxCompletionTokens: Math.max(options.maxCompletionTokens ?? 0, 6400),
	});
	const recovered = extractVerifierFinalEnvelope(text);
	if (!recovered) {
		throw new Error("Private publication verifier failed to produce a safe final-answer envelope.");
	}
	return recovered;
}

async function generateSafeVerifierText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	options: ProviderOptions,
): Promise<string> {
	const verifierOptions: ProviderOptions = {
		...options,
		temperature: 0,
		maxCompletionTokens: Math.max(options.maxCompletionTokens ?? 0, 4800),
	};
	const first = await collectProviderText(provider, messages, verifierOptions);
	const firstEnvelope = extractVerifierFinalEnvelope(first);
	let safeCandidate: string | null = firstEnvelope;

	if (!safeCandidate) {
		const firstTrimmed = first.trim();
		if (firstTrimmed.length >= 120 && !looksLikePrivateAuditLeak(firstTrimmed)) {
			safeCandidate = firstTrimmed;
		}
	}

	if (!safeCandidate) {
		console.warn("[ProviderRouter] Private verifier emitted audit-style or incomplete output; retrying with a final-answer envelope.");
		const retryMessages: ChatCompletionMessageParam[] = [
			...messages,
			{
				role: "user",
				content:
					"Your previous verifier response was rejected because it contained audit/reasoning text or did not provide a complete user-facing answer. Retry the SAME verification task now. Return exactly one wrapper <aira_final> followed by the complete corrected answer for the user and then </aira_final>. Put absolutely no text, analysis, audit notes, preface, or explanation outside that wrapper. Preserve only valid citation markers from the supplied evidence.",
			},
		];
		const retry = await collectProviderText(provider, retryMessages, {
			...verifierOptions,
			maxCompletionTokens: Math.max(verifierOptions.maxCompletionTokens ?? 0, 5600),
		});
		safeCandidate = extractVerifierFinalEnvelope(retry);
		if (!safeCandidate) {
			throw new Error("Private verifier failed to produce a safe final-answer envelope.");
		}
	}

	try {
		return await generatePublicationSafeVerifierText(
			provider,
			messages,
			safeCandidate,
			verifierOptions,
		);
	} catch (error) {
		console.warn(
			"[ProviderRouter] Final private publication pass failed safely; using the already-sanitized verifier answer:",
			errorMessage(error),
		);
		return safeCandidate;
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

	static async createDefault(): Promise<ProviderRouter> {
		const { OpenAIProvider } = await import("./openai-provider");
		const { NVIDIAProvider } = await import("./nvidia-provider");

		const router = new ProviderRouter();

		const openAiKey = process.env.OPENAI_API_KEY;
		if (openAiKey) {
			router.registerProvider(new OpenAIProvider(openAiKey));
		}

		const nvidiaKey = process.env.NVIDIA_API_KEY;
		if (nvidiaKey) {
			router.registerProvider(new NVIDIAProvider(nvidiaKey));
		}

		return router;
	}

	async *streamChat(
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions = {},
	): AsyncGenerator<string, void, undefined> {
		const primary = this.providers.get(this.primaryProviderId);
		const fallback =
			this.fallbackProviderId === this.primaryProviderId
				? undefined
				: this.providers.get(this.fallbackProviderId);

		if (!primary && !fallback) {
			throw new Error("No AI providers configured in ProviderRouter.");
		}

		const verifierCall = isPrivateVerifierCall(messages);
		let useFallback = !primary;

		if (primary) {
			try {
				if (verifierCall) {
					const verifiedText = await generateSafeVerifierText(primary, messages, options);
					if (verifiedText) yield verifiedText;
				} else {
					yield* primary.generateTextStream(messages, options);
				}
				return; // Success, exit
			} catch (error: unknown) {
				const errorStr = errorMessage(error).toLowerCase();
				const isQuotaError =
					errorStr.includes("insufficient_quota") ||
					errorStr.includes("429") ||
					errorStatus(error) === 429 ||
					errorStr.includes("limit_reached");

				if ((verifierCall || isQuotaError) && fallback) {
					console.warn(
						verifierCall
							? `[ProviderRouter] Primary verifier (${this.primaryProviderId}) failed safely. Falling back to ${this.fallbackProviderId}.`
							: `[ProviderRouter] Primary provider (${this.primaryProviderId}) quota exceeded. Falling back to ${this.fallbackProviderId}.`,
					);
					useFallback = true;
				} else {
					throw error;
				}
			}
		}

		if (useFallback && fallback) {
			// A fallback provider cannot safely reuse a model identifier from the
			// primary provider. Always use the fallback provider's configured model.
			const fallbackOptions: ProviderOptions = {
				...options,
				model: fallback.defaultModel,
			};
			if (verifierCall) {
				const verifiedText = await generateSafeVerifierText(fallback, messages, fallbackOptions);
				if (verifiedText) yield verifiedText;
			} else {
				yield* fallback.generateTextStream(messages, fallbackOptions);
			}
		} else if (useFallback) {
			throw new Error("Primary provider failed and no fallback is available.");
		}
	}
}

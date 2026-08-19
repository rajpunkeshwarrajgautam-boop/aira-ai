import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	formatPublicationViolations,
	normalizeModelCitations,
	stripStateContradictionLines,
	validatePublicationCandidate,
	type PublicationViolation,
} from "../publication-guard";

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

function systemMessageContains(
	messages: readonly ChatCompletionMessageParam[],
	needle: string,
): boolean {
	return messages.some((message) =>
		message.role === "system" &&
		typeof message.content === "string" &&
		message.content.includes(needle),
	);
}

function isPrivateVerifierCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return systemMessageContains(messages, "AIRA's final answer verifier and senior editor");
}

function isPrivateStructuredJsonCall(messages: readonly ChatCompletionMessageParam[]): boolean {
	return (
		systemMessageContains(messages, "AIRA's private memory curator") ||
		systemMessageContains(messages, "AIRA's private decision-hypothesis planner")
	);
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

function extractLikelyJsonObject(raw: string): string {
	let text = raw.trim();
	text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Structured task returned no JSON object.");
	return text.slice(start, end + 1);
}

/** Conservative repair for the two malformed-json patterns repeatedly seen in production. */
function repairJsonSurface(raw: string): string {
	return extractLikelyJsonObject(raw)
		.replace(/,\s*([}\]])/g, "$1")
		.replace(/}\s*(?={)/g, "},")
		.replace(/]\s*(?={)/g, "],")
		.replace(/}\s*(?=\"[^\"]+\"\s*:)/g, "},")
		.replace(/]\s*(?=\"[^\"]+\"\s*:)/g, "],")
		.replace(/\"\s*(?=\"[^\"]+\"\s*:)/g, '\",');
}

function parseAndCanonicalizeJson(raw: string): string {
	const parsed: unknown = JSON.parse(repairJsonSurface(raw));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Structured task must return one JSON object.");
	}
	return JSON.stringify(parsed);
}

async function generateSafeStructuredJsonText(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	options: ProviderOptions,
): Promise<string> {
	const structuredOptions: ProviderOptions = {
		...options,
		temperature: 0,
		maxCompletionTokens: Math.max(options.maxCompletionTokens ?? 0, 2600),
	};
	const first = await collectProviderText(provider, messages, structuredOptions);
	try {
		return parseAndCanonicalizeJson(first);
	} catch (firstError) {
		console.warn(
			"[ProviderRouter] Private structured output needed JSON repair/retry:",
			errorMessage(firstError),
		);
	}

	const retryMessages: ChatCompletionMessageParam[] = [
		...messages,
		{
			role: "user",
			content:
				"Your previous private structured response was invalid JSON. Retry the SAME task now. Return exactly one syntactically valid JSON object and nothing else. Check every comma between properties and array elements before responding. Do not use markdown fences or analysis.",
		},
	];
	const retry = await collectProviderText(provider, retryMessages, {
		...structuredOptions,
		maxCompletionTokens: Math.max(structuredOptions.maxCompletionTokens ?? 0, 3200),
	});
	return parseAndCanonicalizeJson(retry);
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
- Citation integrity: use citation markers only in exact [n] form. Preserve only citation numbers that exist in the supplied evidence and keep each citation attached to the exact claim it supports. Never put words such as "est." inside citation brackets.
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

async function repairDeterministicPublicationFailures(
	provider: AIProvider,
	messages: ChatCompletionMessageParam[],
	candidate: string,
	violations: readonly PublicationViolation[],
	options: ProviderOptions,
): Promise<string> {
	const repairMessages: ChatCompletionMessageParam[] = [
		...messages,
		{ role: "assistant", content: candidate },
		{
			role: "user",
			content: `A deterministic publication validator rejected the candidate above. These are machine-detected failures, not optional style suggestions:\n\n${formatPublicationViolations(violations)}\n\nRepair every listed failure while preserving the useful parts of the answer. For an unsupported cited number, either remove/soften the number or use only supplied evidence that actually contains it; do not invent a replacement statistic. For a state contradiction, build on the already-existing user asset instead of instructing the user to create it again. Use citation syntax [1], [2], etc. only. Return exactly <aira_final> followed by the complete corrected answer and then </aira_final>, with no text outside the wrapper.`,
		},
	];
	const text = await collectProviderText(provider, repairMessages, {
		...options,
		temperature: 0,
		maxCompletionTokens: Math.max(options.maxCompletionTokens ?? 0, 6800),
	});
	const recovered = extractVerifierFinalEnvelope(text);
	if (!recovered) throw new Error("Deterministic publication repair did not return a final envelope.");
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

	let publicationCandidate = safeCandidate;
	try {
		publicationCandidate = await generatePublicationSafeVerifierText(
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
	}

	let normalized = normalizeModelCitations(publicationCandidate);
	let violations = validatePublicationCandidate(normalized, messages);
	if (violations.length === 0) return normalized;

	console.warn(
		`[AIRA publication gate] Deterministic validation found ${violations.length} issue(s); repairing before publication.`,
	);
	try {
		const repaired = await repairDeterministicPublicationFailures(
			provider,
			messages,
			normalized,
			violations,
			verifierOptions,
		);
		normalized = normalizeModelCitations(repaired);
		violations = validatePublicationCandidate(normalized, messages);
		if (violations.length === 0) return normalized;
		console.warn(
			`[AIRA publication gate] ${violations.length} deterministic issue(s) remained after repair; stripping duplicate-state instructions and publishing the repaired answer.`,
		);
		return stripStateContradictionLines(normalized, violations);
	} catch (error) {
		console.warn(
			"[AIRA publication gate] Deterministic repair failed; stripping duplicate-state instructions from the verified answer:",
			errorMessage(error),
		);
		return stripStateContradictionLines(normalized, violations);
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
		const structuredJsonCall = isPrivateStructuredJsonCall(messages);
		let useFallback = !primary;

		if (primary) {
			try {
				if (verifierCall) {
					const verifiedText = await generateSafeVerifierText(primary, messages, options);
					if (verifiedText) yield verifiedText;
				} else if (structuredJsonCall) {
					const jsonText = await generateSafeStructuredJsonText(primary, messages, options);
					if (jsonText) yield jsonText;
				} else {
					yield* primary.generateTextStream(messages, options);
				}
				return;
			} catch (error: unknown) {
				const errorStr = errorMessage(error).toLowerCase();
				const isQuotaError =
					errorStr.includes("insufficient_quota") ||
					errorStr.includes("429") ||
					errorStatus(error) === 429 ||
					errorStr.includes("limit_reached");

				if ((verifierCall || structuredJsonCall || isQuotaError) && fallback) {
					console.warn(
						verifierCall
							? `[ProviderRouter] Primary verifier (${this.primaryProviderId}) failed safely. Falling back to ${this.fallbackProviderId}.`
							: structuredJsonCall
								? `[ProviderRouter] Primary structured task (${this.primaryProviderId}) failed safely. Falling back to ${this.fallbackProviderId}.`
								: `[ProviderRouter] Primary provider (${this.primaryProviderId}) quota exceeded. Falling back to ${this.fallbackProviderId}.`,
					);
					useFallback = true;
				} else {
					throw error;
				}
			}
		}

		if (useFallback && fallback) {
			const fallbackOptions: ProviderOptions = {
				...options,
				model: fallback.defaultModel,
			};
			if (verifierCall) {
				const verifiedText = await generateSafeVerifierText(fallback, messages, fallbackOptions);
				if (verifiedText) yield verifiedText;
			} else if (structuredJsonCall) {
				const jsonText = await generateSafeStructuredJsonText(fallback, messages, fallbackOptions);
				if (jsonText) yield jsonText;
			} else {
				yield* fallback.generateTextStream(messages, fallbackOptions);
			}
		} else if (useFallback) {
			throw new Error("Primary provider failed and no fallback is available.");
		}
	}
}

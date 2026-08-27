/**
 * Prompt execution for the Test Playground, Prompt Compare and evaluations.
 *
 * This module composes AIRA's existing pieces rather than introducing a second
 * inference stack: provider selection and failover come from `ProviderRouter`,
 * provider clients are the same classes Compare uses, OmniRoute configuration
 * and routing-mode validation come from the OmniRoute services, and the safety
 * gateway runs on input exactly as it does elsewhere.
 *
 * Everything reported back is measured. Latency is wall-clock around the
 * stream; provider and model are the values actually used. Token counts and
 * cost are not reported because the streaming interface does not expose usage —
 * reporting them would mean inventing them.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { isOmniRouteRoutingMode, OMNIROUTE_ROUTING_MODES } from "@services/omniroute/routing";
import { AIRA_CORE_SYSTEM_PROMPT } from "@services/answer";
import { compilePrompt, type CompiledPrompt } from "@services/prompt/prompt-compiler";
import type { PromptVariableDefinition } from "@services/prompt/prompt-variables";
import { DEFAULT_NVIDIA_MODEL, NVIDIAProvider } from "@services/providers/nvidia-provider";
import { OmniRouteProvider } from "@services/providers/omniroute-provider";
import { OpenAIProvider } from "@services/providers/openai-provider";
import { ProviderRouter } from "@services/providers/provider-router";
import { OmniRouteGatewayError } from "@services/omniroute/gateway";
import {
	SafetyBlockedError,
	SafetyGatewayError,
} from "@services/safety/safety-gateway";

export const PROMPT_PROVIDER_IDS = ["openai", "nvidia", "omniroute"] as const;
export type PromptProviderId = (typeof PROMPT_PROVIDER_IDS)[number];

export const PROMPT_TEST_MAX_TOKENS = 1_600;

/**
 * Mode policy for a standalone prompt run.
 *
 * The playground exercises the real compiler, so AIRA's core policy is present
 * and the template still occupies the low-trust `template` layer. What differs
 * from a research request is only that no retrieval ran.
 */
const PROMPT_TEST_MODE_POLICY = `## Prompt Studio test run
This request is a direct test of a prompt template. No live web retrieval ran for it.
- Answer the user's message using the template's guidance and careful reasoning.
- Do not claim to have browsed the web, and do not produce citation markers for sources you were not given.
- If the template asks for evidence you were not supplied, say what is missing instead of inventing it.`;

export interface PromptProviderDescriptor {
	readonly id: PromptProviderId;
	readonly label: string;
	readonly configured: boolean;
	readonly model: string;
	readonly routingModes?: readonly string[];
}

/** Mirrors the descriptor shape Compare exposes, from the same configuration. */
export function promptProviderDescriptors(): readonly PromptProviderDescriptor[] {
	const omniRoute = getOmniRouteConfigOrDisabled();
	return [
		{
			id: "omniroute",
			label: "OmniRoute",
			configured: omniRoute.configured,
			model: omniRoute.model,
			routingModes: OMNIROUTE_ROUTING_MODES,
		},
		{
			id: "openai",
			label: "OpenAI",
			configured: Boolean(process.env.OPENAI_API_KEY),
			model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
		},
		{
			id: "nvidia",
			label: "NVIDIA",
			configured: Boolean(process.env.NVIDIA_API_KEY),
			model: process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL,
		},
	];
}

/**
 * Builds a single-provider router. Isolating each target to one provider is
 * what makes comparison targets fail independently: a failure in one target
 * cannot silently fail over into another target's provider.
 */
function createSingleProviderRouter(id: PromptProviderId): ProviderRouter | null {
	const router = new ProviderRouter(id, id);
	if (id === "omniroute") {
		const omniRoute = getOmniRouteConfigOrDisabled();
		if (!omniRoute.configured) return null;
		router.registerProvider(
			new OmniRouteProvider({
				baseURL: omniRoute.baseURL,
				apiKey: omniRoute.apiKey,
				model: omniRoute.model,
				timeoutMs: omniRoute.timeoutMs,
			}),
		);
		return router;
	}
	if (id === "openai" && process.env.OPENAI_API_KEY) {
		router.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));
		return router;
	}
	if (id === "nvidia" && process.env.NVIDIA_API_KEY) {
		router.registerProvider(new NVIDIAProvider(process.env.NVIDIA_API_KEY));
		return router;
	}
	return null;
}

/** Never leaks provider credentials, URLs or upstream response bodies. */
export function publicProviderError(error: unknown): string {
	if (error instanceof SafetyBlockedError) return error.message;
	if (error instanceof SafetyGatewayError) return "AIRA's safety gateway is unavailable.";
	if (error instanceof OmniRouteGatewayError) return error.message;
	if (error instanceof Error && error.name === "AbortError") return "The request timed out.";
	const status =
		typeof error === "object" && error !== null && "status" in error
			? (error as { readonly status?: unknown }).status
			: undefined;
	if (status === 401 || status === 403) return "The provider rejected AIRA's credentials.";
	if (status === 429) return "The provider is temporarily rate limited.";
	if (status === 404) return "The selected model is unavailable.";
	return "Provider request failed.";
}

export interface PromptRunTemplate {
	readonly promptId: string;
	readonly versionId: string;
	readonly version: number;
	readonly name: string;
	readonly body: string;
	readonly variables: readonly PromptVariableDefinition[];
	readonly values?: Readonly<Record<string, unknown>>;
}

export function compilePromptRun(
	template: PromptRunTemplate,
	userMessage: string,
): CompiledPrompt {
	return compilePrompt({
		core: AIRA_CORE_SYSTEM_PROMPT,
		modePolicy: PROMPT_TEST_MODE_POLICY,
		template: {
			promptId: template.promptId,
			versionId: template.versionId,
			version: template.version,
			name: template.name,
			body: template.body,
			variables: template.variables,
			values: template.values,
		},
		userRequest: userMessage,
	});
}

export interface PromptRunTarget {
	readonly targetId: string;
	readonly providerId: PromptProviderId;
	/** A concrete model id, or an OmniRoute routing mode such as `auto/smart`. */
	readonly model?: string;
	readonly template: PromptRunTemplate;
}

export type PromptRunEvent =
	| {
			readonly type: "start";
			readonly targetId: string;
			readonly providerId: PromptProviderId;
			readonly model: string;
			readonly promptVersionId: string;
		}
	| { readonly type: "delta"; readonly targetId: string; readonly delta: string }
	| {
			readonly type: "complete";
			readonly targetId: string;
			readonly providerId: PromptProviderId;
			readonly model: string;
			readonly promptVersionId: string;
			readonly text: string;
			readonly latencyMs: number;
			readonly characters: number;
		}
	| {
			readonly type: "error";
			readonly targetId: string;
			readonly providerId: PromptProviderId;
			readonly model: string;
			readonly promptVersionId: string;
			readonly error: string;
		};

export function resolveTargetModel(target: PromptRunTarget): string {
	const descriptor = promptProviderDescriptors().find((entry) => entry.id === target.providerId);
	const requested = target.model?.trim();
	if (requested) return requested;
	return descriptor?.model ?? "default";
}

export function isValidOmniRouteSelection(model: string | undefined): boolean {
	if (!model) return true;
	return isOmniRouteRoutingMode(model) || model.length > 0;
}

export interface RunPromptTargetOptions {
	readonly userMessage: string;
	readonly abortSignal?: AbortSignal;
	readonly temperature?: number;
	readonly maxCompletionTokens?: number;
	readonly timeoutMs?: number;
}

/**
 * Runs one target to completion, publishing measured events.
 *
 * Every failure path is contained: a rejected provider, an aborted stream or a
 * timeout ends this target only. Callers run targets with `Promise.all` over
 * this function, so one failing target cannot collapse the others.
 */
export async function runPromptTarget(
	target: PromptRunTarget,
	options: RunPromptTargetOptions,
	publish: (event: PromptRunEvent) => void,
): Promise<void> {
	const model = resolveTargetModel(target);
	const base = {
		targetId: target.targetId,
		providerId: target.providerId,
		model,
		promptVersionId: target.template.versionId,
	} as const;

	publish({ type: "start", ...base });

	const router = createSingleProviderRouter(target.providerId);
	if (!router) {
		publish({ type: "error", ...base, error: "Provider is not configured." });
		return;
	}

	let compiled: CompiledPrompt;
	try {
		compiled = compilePromptRun(target.template, options.userMessage);
	} catch (error) {
		publish({
			type: "error",
			...base,
			error: error instanceof Error ? error.message : "Prompt could not be compiled.",
		});
		return;
	}

	const controller = new AbortController();
	const timeout = options.timeoutMs
		? setTimeout(() => controller.abort(), options.timeoutMs)
		: undefined;
	const onExternalAbort = () => controller.abort();
	options.abortSignal?.addEventListener("abort", onExternalAbort, { once: true });

	const startedAt = Date.now();
	let text = "";
	try {
		const messages: ChatCompletionMessageParam[] = compiled.messages;
		for await (const delta of router.streamChat(messages, {
			model,
			temperature: options.temperature ?? 0.2,
			maxCompletionTokens: options.maxCompletionTokens ?? PROMPT_TEST_MAX_TOKENS,
			abortSignal: controller.signal,
		})) {
			text += delta;
			publish({ type: "delta", targetId: target.targetId, delta });
		}
		publish({
			type: "complete",
			...base,
			text,
			latencyMs: Date.now() - startedAt,
			characters: text.length,
		});
	} catch (error) {
		publish({ type: "error", ...base, error: publicProviderError(error) });
	} finally {
		if (timeout) clearTimeout(timeout);
		options.abortSignal?.removeEventListener("abort", onExternalAbort);
	}
}

/** Collects a target's full output without streaming. Used by evaluations. */
export async function completePromptTarget(
	target: PromptRunTarget,
	options: RunPromptTargetOptions,
): Promise<{
	readonly ok: boolean;
	readonly text: string;
	readonly latencyMs: number;
	readonly providerId: PromptProviderId;
	readonly model: string;
	readonly error?: string;
}> {
	let text = "";
	let latencyMs = 0;
	let error: string | undefined;
	const model = resolveTargetModel(target);

	await runPromptTarget(target, options, (event) => {
		if (event.type === "complete") {
			text = event.text;
			latencyMs = event.latencyMs;
		} else if (event.type === "error") {
			error = event.error;
		}
	});

	return { ok: error === undefined, text, latencyMs, providerId: target.providerId, model, error };
}

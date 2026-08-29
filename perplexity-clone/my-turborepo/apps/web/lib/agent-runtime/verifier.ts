import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { PlannerModelRouter } from "./planner";

const VerificationSchema = z.object({
	verdict: z.enum(["PASS", "FAIL", "NEEDS_HUMAN_APPROVAL"]),
	summary: z.string().trim().min(3).max(1_200),
	evidence: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
	failures: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
	repairInstructions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export type VerificationResult = z.infer<typeof VerificationSchema>;

export class VerificationOutputError extends Error {
	readonly code = "AGENT_VERIFIER_OUTPUT_INVALID";

	constructor(message: string) {
		super(message);
		this.name = "VerificationOutputError";
	}
}

export function parseVerificationResult(raw: string): VerificationResult {
	const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new VerificationOutputError("Verifier did not return JSON.");
	let value: unknown;
	try {
		value = JSON.parse(trimmed.slice(start, end + 1));
	} catch {
		throw new VerificationOutputError("Verifier returned malformed JSON.");
	}
	const parsed = VerificationSchema.safeParse(value);
	if (!parsed.success) {
		throw new VerificationOutputError(`Verifier output failed schema validation: ${z.prettifyError(parsed.error)}`);
	}
	if (parsed.data.verdict === "PASS" && parsed.data.failures.length > 0) {
		throw new VerificationOutputError("PASS cannot include unresolved failures.");
	}
	return parsed.data;
}

const VERIFIER_SYSTEM_PROMPT = `You are AIRA's independent execution verifier. Inspect the objective, acceptance criteria, worker result, and observable evidence. Return a verdict without exposing private chain-of-thought.

Rules:
- Return JSON only.
- PASS only when observable evidence supports the required outcome.
- FAIL when implementation or evidence is materially incomplete, inconsistent, or broken.
- NEEDS_HUMAN_APPROVAL only when the remaining boundary is a consequential action that policy requires a person to authorize.
- Never treat a worker's claim that something succeeded as proof by itself.
- Repair instructions must be concrete and testable.
- Do not invent screenshots, test results, deployments, external state, or credentials.

Schema:
{"verdict":"PASS|FAIL|NEEDS_HUMAN_APPROVAL","summary":"string","evidence":["string"],"failures":["string"],"repairInstructions":["string"]}`;

export interface VerifyOutcomeInput {
	readonly objective: string;
	readonly taskTitle: string;
	readonly taskDescription?: string;
	readonly acceptanceCriteria?: readonly string[];
	readonly workerResult: unknown;
	readonly observableEvidence?: readonly string[];
}

export async function verifyOutcome(
	input: VerifyOutcomeInput,
	options: { readonly router?: PlannerModelRouter; readonly abortSignal?: AbortSignal } = {},
): Promise<VerificationResult> {
	let router = options.router;
	if (!router) {
		const { ProviderRouter } = await import("@services/providers/provider-router");
		router = await ProviderRouter.createDefault();
	}
	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: VERIFIER_SYSTEM_PROMPT },
		{
			role: "user",
			content: JSON.stringify({
				objective: input.objective,
				task: {
					title: input.taskTitle,
					description: input.taskDescription ?? null,
				},
				acceptanceCriteria: input.acceptanceCriteria ?? [],
				workerResult: input.workerResult,
				observableEvidence: input.observableEvidence ?? [],
			}),
		},
	];
	let raw = "";
	for await (const delta of router.streamChat(messages, {
		temperature: 0,
		abortSignal: options.abortSignal,
	})) {
		raw += delta;
	}
	return parseVerificationResult(raw);
}

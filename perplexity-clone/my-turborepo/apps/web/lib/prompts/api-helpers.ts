/**
 * Shared response and validation helpers for the Prompt Studio API.
 *
 * Every prompt route resolves the session first and passes the resolved user id
 * into the registry, which scopes its queries by it. UI-level hiding is never
 * treated as authorization.
 */

import { z } from "zod";

import { auth } from "@/auth";
import { PromptVariableError } from "@services/prompt/prompt-variables";
import { ExternalIngestionError } from "@services/prompt/external-prompt-ingestion";

import { PromptRegistryError } from "./prompt-registry";

export function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export function unauthenticated(): Response {
	return noStoreJson(
		{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
		{ status: 401 },
	);
}

export function validationError(message: string, details?: unknown): Response {
	return noStoreJson(
		{ error: { code: "VALIDATION_ERROR", message, ...(details ? { details } : {}) } },
		{ status: 400 },
	);
}

export async function requireUserId(): Promise<
	{ readonly ok: true; readonly userId: string } | { readonly ok: false; readonly response: Response }
> {
	const session = await auth();
	if (!session?.user?.id) return { ok: false, response: unauthenticated() };
	return { ok: true, userId: session.user.id };
}

export async function readJsonBody<T>(
	req: Request,
	schema: z.ZodType<T>,
): Promise<{ readonly ok: true; readonly data: T } | { readonly ok: false; readonly response: Response }> {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return {
			ok: false,
			response: noStoreJson(
				{ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } },
				{ status: 400 },
			),
		};
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			response: validationError("Request did not match the expected shape.", z.treeifyError(parsed.error)),
		};
	}
	return { ok: true, data: parsed.data };
}

/** Maps known domain errors to responses; anything else is logged without detail. */
export function promptErrorResponse(error: unknown, context: string): Response {
	if (error instanceof PromptRegistryError) {
		return noStoreJson({ error: { code: error.code, message: error.message } }, { status: error.status });
	}
	if (error instanceof PromptVariableError) {
		return noStoreJson({ error: { code: error.code, message: error.message } }, { status: 400 });
	}
	if (error instanceof ExternalIngestionError) {
		return noStoreJson({ error: { code: error.code, message: error.message } }, { status: 400 });
	}
	console.error("[prompts]", { context, code: "PROMPT_REQUEST_FAILED" });
	return noStoreJson(
		{ error: { code: "PROMPT_REQUEST_FAILED", message: "The request could not be completed." } },
		{ status: 500 },
	);
}

// --- Shared schemas --------------------------------------------------------

export const PromptIdSchema = z.string().trim().min(3).max(128);

export const VariableDefinitionSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.max(48)
		.regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
			error: "Variable names use letters, digits and underscores, starting with a letter.",
		}),
	label: z.string().trim().max(80).optional(),
	description: z.string().trim().max(240).optional(),
	required: z.boolean().optional(),
	defaultValue: z.string().max(2_000).optional(),
});

export const PromptBodySchema = z.string().min(1).max(40_000);

export const VersionPayloadSchema = z.object({
	body: PromptBodySchema,
	variables: z.array(VariableDefinitionSchema).max(24).optional(),
	providerCompatibility: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
	modelCompatibility: z.array(z.string().trim().min(1).max(200)).max(24).optional(),
	toolRequirements: z.array(z.string().trim().min(1).max(64)).max(24).optional(),
	notes: z.string().trim().max(500).optional(),
});

export const VariableValuesSchema = z.record(z.string().max(48), z.string().max(4_000)).optional();

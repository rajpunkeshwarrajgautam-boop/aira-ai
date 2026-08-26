/**
 * Resolves the prompt template that applies to a runtime request.
 *
 * Three properties matter here:
 *  - Resolution is server-side and ownership-scoped. A client may name a
 *    prompt id, but the lookup is filtered by the session user, so naming
 *    another user's prompt resolves to nothing rather than to their template.
 *  - Only PUBLISHED prompts resolve. A draft can be run in the playground but
 *    never reaches chat, agents or evaluations.
 *  - Failure is silent and safe: if anything cannot be resolved, the request
 *    proceeds with AIRA's default composition rather than erroring out. A
 *    template is a preference, not a dependency.
 */

import { PromptStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PromptTemplateInput } from "@services/prompt/prompt-compiler";
import { parseVariableDefinitions } from "@services/prompt/prompt-variables";

import { resolveAssignedTemplate } from "./prompt-registry";

export interface RuntimeTemplateRequest {
	readonly userId: string | null;
	readonly promptId?: string | null;
	readonly conversationId?: string | null;
	readonly agentKey?: string | null;
}

export async function resolveRuntimeTemplate(
	request: RuntimeTemplateRequest,
): Promise<PromptTemplateInput | undefined> {
	if (!request.userId) return undefined;

	try {
		if (request.promptId) {
			const prompt = await prisma.prompt.findFirst({
				where: { id: request.promptId, userId: request.userId },
				include: { publishedVersion: true },
			});
			if (
				!prompt ||
				prompt.status !== PromptStatus.PUBLISHED ||
				!prompt.publishedVersion
			) {
				return undefined;
			}
			return {
				promptId: prompt.id,
				versionId: prompt.publishedVersion.id,
				version: prompt.publishedVersion.version,
				name: prompt.name,
				body: prompt.publishedVersion.body,
				variables: parseVariableDefinitions(prompt.publishedVersion.variables),
			};
		}

		const assigned = await resolveAssignedTemplate({
			userId: request.userId,
			conversationId: request.conversationId ?? null,
			agentKey: request.agentKey ?? null,
		});
		if (!assigned) return undefined;

		return {
			promptId: assigned.promptId,
			versionId: assigned.versionId,
			version: assigned.version,
			name: assigned.name,
			body: assigned.body,
			variables: assigned.variables,
		};
	} catch (error) {
		// A template lookup must never take down an answer.
		console.warn(
			"[prompts] Template resolution failed; continuing with AIRA defaults.",
			error instanceof Error ? error.message.slice(0, 160) : "unknown error",
		);
		return undefined;
	}
}

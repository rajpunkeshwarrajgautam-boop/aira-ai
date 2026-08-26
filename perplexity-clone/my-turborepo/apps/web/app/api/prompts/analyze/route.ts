import { z } from "zod";

import {
	noStoreJson,
	PromptBodySchema,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
	VariableDefinitionSchema,
} from "@/lib/prompts/api-helpers";
import { compilePrompt, promptDebugView } from "@services/prompt/prompt-compiler";
import { promptLayerDescriptors } from "@services/prompt/prompt-layers";
import { analyzePromptBody } from "@services/prompt/prompt-security";
import { AIRA_CORE_SYSTEM_PROMPT } from "@services/answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AnalyzeSchema = z.object({
	body: PromptBodySchema,
	variables: z.array(VariableDefinitionSchema).max(24).optional(),
	/** Optional sample values, used only to preview unresolved variables. */
	values: z.record(z.string().max(48), z.string().max(4_000)).optional(),
});

/**
 * Static analysis for the editor, plus a composition preview.
 *
 * The preview reports which layers would be active and how large each one is.
 * It never returns the text of a protected layer: AIRA's core prompt is
 * compiled here only so the character counts are real, and `promptDebugView`
 * strips the content before it leaves the server.
 */
export async function POST(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, AnalyzeSchema);
	if (!body.ok) return body.response;

	try {
		const variables = body.data.variables ?? [];
		const report = analyzePromptBody(body.data.body, { variables });

		const compiled = compilePrompt({
			core: AIRA_CORE_SYSTEM_PROMPT,
			modePolicy: "Prompt Studio composition preview.",
			template: {
				promptId: "preview",
				versionId: "preview",
				version: 0,
				name: "Draft under review",
				body: body.data.body,
				variables,
				values: body.data.values ?? {},
			},
			userRequest: "(the user's message would appear here)",
		});

		return noStoreJson({
			analysis: {
				findings: report.findings,
				counts: report.counts,
				maxSeverity: report.maxSeverity,
				analyzedCharacters: report.analyzedCharacters,
				protectedLayersEnforced: report.protectedLayersEnforced,
			},
			variables: {
				resolved: compiled.templateRender?.resolved ?? [],
				unresolved: compiled.templateRender?.unresolved ?? [],
				unused: compiled.templateRender?.unused ?? [],
				truncated: compiled.templateRender?.truncated ?? [],
			},
			composition: promptDebugView(compiled),
			hierarchy: promptLayerDescriptors().map((layer) => ({
				id: layer.id,
				rank: layer.rank,
				label: layer.label,
				protected: layer.protected,
				description: layer.description,
			})),
		});
	} catch (error) {
		return promptErrorResponse(error, "analyze");
	}
}

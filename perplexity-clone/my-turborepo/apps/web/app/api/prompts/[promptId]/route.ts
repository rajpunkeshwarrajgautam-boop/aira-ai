import { z } from "zod";

import { PromptVisibility } from "@/generated/prisma/enums";
import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import { deletePrompt, getPromptDetail, updatePromptMetadata } from "@/lib/prompts/prompt-registry";
import { parseVariableDefinitions } from "@services/prompt/prompt-variables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ promptId: string }> };

const UpdateSchema = z.object({
	name: z.string().trim().min(2).max(120).optional(),
	description: z.string().trim().max(600).nullable().optional(),
	category: z.string().trim().min(1).max(48).optional(),
	tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
	visibility: z.enum(["PRIVATE", "WORKSPACE"]).optional(),
});

export async function GET(_req: Request, { params }: Params): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	const { promptId } = await params;

	try {
		const prompt = await getPromptDetail(session.userId, promptId);
		return noStoreJson({
			prompt: {
				id: prompt.id,
				name: prompt.name,
				slug: prompt.slug,
				description: prompt.description,
				category: prompt.category,
				tags: prompt.tags,
				status: prompt.status,
				visibility: prompt.visibility,
				origin: prompt.origin,
				publishedVersionId: prompt.publishedVersionId,
				externalSource: prompt.externalSource,
				createdAt: prompt.createdAt,
				updatedAt: prompt.updatedAt,
				archivedAt: prompt.archivedAt,
			},
			versions: prompt.versions.map((version) => ({
				id: version.id,
				version: version.version,
				body: version.body,
				variables: parseVariableDefinitions(version.variables),
				providerCompatibility: version.providerCompatibility,
				modelCompatibility: version.modelCompatibility,
				toolRequirements: version.toolRequirements,
				securityFindings: version.securityFindings,
				securityMaxSeverity: version.securityMaxSeverity,
				notes: version.notes,
				contentHash: version.contentHash,
				createdAt: version.createdAt,
				isPublished: version.id === prompt.publishedVersionId,
			})),
		});
	} catch (error) {
		return promptErrorResponse(error, "detail");
	}
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	const { promptId } = await params;

	const body = await readJsonBody(req, UpdateSchema);
	if (!body.ok) return body.response;

	try {
		const prompt = await updatePromptMetadata(session.userId, promptId, {
			...body.data,
			visibility: body.data.visibility ? (body.data.visibility as PromptVisibility) : undefined,
		});
		return noStoreJson({ prompt: { id: prompt.id, name: prompt.name, updatedAt: prompt.updatedAt } });
	} catch (error) {
		return promptErrorResponse(error, "update");
	}
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	const { promptId } = await params;

	try {
		await deletePrompt(session.userId, promptId);
		return noStoreJson({ ok: true });
	} catch (error) {
		return promptErrorResponse(error, "delete");
	}
}

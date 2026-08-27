import { z } from "zod";

import { PromptStatus, PromptVisibility } from "@/generated/prisma/enums";
import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
	VersionPayloadSchema,
} from "@/lib/prompts/api-helpers";
import { createPrompt, listPrompts } from "@/lib/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreatePromptSchema = VersionPayloadSchema.extend({
	name: z.string().trim().min(2).max(120),
	description: z.string().trim().max(600).optional(),
	category: z.string().trim().min(1).max(48).optional(),
	tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
	visibility: z.enum(["PRIVATE", "WORKSPACE"]).optional(),
});

export async function GET(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const url = new URL(req.url);
	const statusParam = url.searchParams.get("status");
	const status =
		statusParam === "DRAFT" || statusParam === "PUBLISHED" || statusParam === "ARCHIVED"
			? (statusParam as PromptStatus)
			: undefined;

	try {
		const prompts = await listPrompts(session.userId, {
			status,
			category: url.searchParams.get("category")?.trim() || undefined,
			search: url.searchParams.get("q")?.trim() || undefined,
		});
		return noStoreJson({
			prompts: prompts.map((prompt) => ({
				id: prompt.id,
				name: prompt.name,
				slug: prompt.slug,
				description: prompt.description,
				category: prompt.category,
				tags: prompt.tags,
				status: prompt.status,
				visibility: prompt.visibility,
				origin: prompt.origin,
				versionCount: prompt._count.versions,
				publishedVersion: prompt.publishedVersion
					? { id: prompt.publishedVersion.id, version: prompt.publishedVersion.version }
					: null,
				updatedAt: prompt.updatedAt,
				createdAt: prompt.createdAt,
			})),
		});
	} catch (error) {
		return promptErrorResponse(error, "list");
	}
}

export async function POST(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, CreatePromptSchema);
	if (!body.ok) return body.response;

	try {
		const prompt = await createPrompt(session.userId, {
			...body.data,
			visibility: body.data.visibility ? (body.data.visibility as PromptVisibility) : undefined,
		});
		return noStoreJson(
			{
				prompt: {
					id: prompt.id,
					name: prompt.name,
					slug: prompt.slug,
					status: prompt.status,
					versions: prompt.versions.map((version) => ({
						id: version.id,
						version: version.version,
						securityMaxSeverity: version.securityMaxSeverity,
					})),
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return promptErrorResponse(error, "create");
	}
}

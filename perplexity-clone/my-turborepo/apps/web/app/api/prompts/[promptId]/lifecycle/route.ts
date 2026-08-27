import { z } from "zod";

import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import {
	archivePrompt,
	duplicatePrompt,
	publishPromptVersion,
	restorePrompt,
	restorePromptVersion,
	unpublishPrompt,
} from "@/lib/prompts/prompt-registry";
import { assertVersionMutationAllowed } from "@services/prompt/prompt-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ promptId: string }> };

const LifecycleSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("publish"), versionId: z.string().trim().min(3).max(128) }),
	z.object({ action: z.literal("unpublish") }),
	z.object({ action: z.literal("archive") }),
	z.object({ action: z.literal("restore") }),
	z.object({ action: z.literal("duplicate") }),
	z.object({ action: z.literal("restore-version"), versionId: z.string().trim().min(3).max(128) }),
]);

export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	const { promptId } = await params;

	const body = await readJsonBody(req, LifecycleSchema);
	if (!body.ok) return body.response;

	try {
		switch (body.data.action) {
			case "publish": {
				assertVersionMutationAllowed("publish");
				const prompt = await publishPromptVersion(session.userId, promptId, body.data.versionId);
				return noStoreJson({
					prompt: { id: prompt.id, status: prompt.status, publishedVersionId: prompt.publishedVersionId },
				});
			}
			case "unpublish": {
				assertVersionMutationAllowed("unpublish");
				const prompt = await unpublishPrompt(session.userId, promptId);
				return noStoreJson({ prompt: { id: prompt.id, status: prompt.status, publishedVersionId: null } });
			}
			case "archive": {
				const prompt = await archivePrompt(session.userId, promptId);
				return noStoreJson({ prompt: { id: prompt.id, status: prompt.status } });
			}
			case "restore": {
				const prompt = await restorePrompt(session.userId, promptId);
				return noStoreJson({ prompt: { id: prompt.id, status: prompt.status } });
			}
			case "duplicate": {
				const prompt = await duplicatePrompt(session.userId, promptId);
				return noStoreJson({ prompt: { id: prompt.id, name: prompt.name, slug: prompt.slug } }, { status: 201 });
			}
			case "restore-version": {
				// Never rewrites the old row — appends a new version from its body.
				assertVersionMutationAllowed("create");
				const version = await restorePromptVersion(session.userId, promptId, body.data.versionId);
				return noStoreJson({ version: { id: version.id, version: version.version } }, { status: 201 });
			}
		}
	} catch (error) {
		return promptErrorResponse(error, "lifecycle");
	}
}

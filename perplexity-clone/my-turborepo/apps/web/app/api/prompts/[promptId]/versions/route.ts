import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
	VersionPayloadSchema,
} from "@/lib/prompts/api-helpers";
import { createPromptVersion } from "@/lib/prompts/prompt-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ promptId: string }> };

/**
 * Creates the next immutable version.
 *
 * There is deliberately no PATCH/PUT for an existing version: editing a
 * published prompt appends a new version and leaves history intact.
 */
export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	const { promptId } = await params;

	const body = await readJsonBody(req, VersionPayloadSchema);
	if (!body.ok) return body.response;

	try {
		const version = await createPromptVersion(session.userId, promptId, body.data);
		return noStoreJson(
			{
				version: {
					id: version.id,
					version: version.version,
					contentHash: version.contentHash,
					securityFindings: version.securityFindings,
					securityMaxSeverity: version.securityMaxSeverity,
					createdAt: version.createdAt,
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return promptErrorResponse(error, "create-version");
	}
}

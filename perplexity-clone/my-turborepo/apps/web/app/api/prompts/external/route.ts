import { z } from "zod";

import { PromptExternalTransformStatus } from "@/generated/prisma/enums";
import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import {
	createTemplateFromReference,
	deleteExternalSource,
	ingestExternalSource,
	listExternalSources,
	setExternalSourceStatus,
} from "@/lib/prompts/prompt-external-catalog";
import {
	ALLOWED_SOURCE_PREFIXES,
	MAX_EXTERNAL_SOURCE_BYTES,
	REFERENCE_LICENSE_NOTICE,
	REFERENCE_REPOSITORY,
	REFERENCE_REPOSITORY_URL,
} from "@services/prompt/external-prompt-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * External reference catalog.
 *
 * The body is supplied by the caller rather than fetched here on a schedule, and
 * nothing on a chat request path reaches this route. Ingestion parses metadata
 * and records provenance; the text is stored as untrusted reference data and is
 * never compiled into a prompt layer.
 */
const IngestSchema = z.object({
	repository: z.string().trim().min(3).max(140),
	path: z.string().trim().min(3).max(400),
	commitSha: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{7,40}$/, { error: "A commit SHA is required for provenance." }),
	body: z.string().min(1).max(MAX_EXTERNAL_SOURCE_BYTES),
});

const StatusSchema = z.object({
	sourceId: z.string().trim().min(3).max(128),
	transformationStatus: z.enum(["UNREVIEWED", "REVIEWED", "TRANSFORMED", "REJECTED"]),
});

const DeriveSchema = z.object({
	sourceId: z.string().trim().min(3).max(128),
	action: z.literal("derive-template"),
});

const DeleteSchema = z.object({ sourceId: z.string().trim().min(3).max(128) });

export async function GET(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	try {
		const sources = await listExternalSources(session.userId);
		return noStoreJson({
			corpus: {
				repository: REFERENCE_REPOSITORY,
				url: REFERENCE_REPOSITORY_URL,
				allowedPaths: ALLOWED_SOURCE_PREFIXES,
				licenseNotice: REFERENCE_LICENSE_NOTICE,
				maxBytes: MAX_EXTERNAL_SOURCE_BYTES,
			},
			sources,
		});
	} catch (error) {
		return promptErrorResponse(error, "external-list");
	}
}

export async function POST(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const derive = await req
		.clone()
		.json()
		.then((raw) => DeriveSchema.safeParse(raw))
		.catch(() => null);

	if (derive?.success) {
		try {
			const prompt = await createTemplateFromReference(session.userId, derive.data.sourceId);
			return noStoreJson(
				{ prompt: { id: prompt.id, name: prompt.name, slug: prompt.slug } },
				{ status: 201 },
			);
		} catch (error) {
			return promptErrorResponse(error, "external-derive");
		}
	}

	const body = await readJsonBody(req, IngestSchema);
	if (!body.ok) return body.response;

	try {
		const source = await ingestExternalSource(session.userId, body.data);
		return noStoreJson(
			{
				source: {
					id: source.id,
					title: source.title,
					path: source.path,
					url: source.url,
					commitSha: source.commitSha,
					contentHash: source.contentHash,
					category: source.category,
					transformationStatus: source.transformationStatus,
					securityNotes: source.securityNotes,
					licenseNotice: source.licenseNotice,
				},
			},
			{ status: 201 },
		);
	} catch (error) {
		return promptErrorResponse(error, "external-ingest");
	}
}

export async function PATCH(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, StatusSchema);
	if (!body.ok) return body.response;

	try {
		const result = await setExternalSourceStatus(
			session.userId,
			body.data.sourceId,
			body.data.transformationStatus as PromptExternalTransformStatus,
		);
		return noStoreJson(result);
	} catch (error) {
		return promptErrorResponse(error, "external-status");
	}
}

export async function DELETE(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, DeleteSchema);
	if (!body.ok) return body.response;

	try {
		const result = await deleteExternalSource(session.userId, body.data.sourceId);
		return noStoreJson(result);
	} catch (error) {
		return promptErrorResponse(error, "external-delete");
	}
}

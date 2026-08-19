import { createHash, randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { enqueueFoundationJob } from "@/lib/foundation-control-plane";
import {
	createKnowledgeAsset,
	listKnowledgeAssets,
	updateKnowledgeAssetStatus,
} from "@/lib/knowledge-assets";
import {
	createKnowledgeSignedUrl,
	deleteKnowledgeObject,
	knowledgeStorageConfigured,
	uploadKnowledgeObject,
} from "@/lib/foundation-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"image/png",
	"image/jpeg",
	"image/webp",
]);

function unauthenticated(): Response {
	return Response.json(
		{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
		{ status: 401 },
	);
}

function disabled(): Response {
	return Response.json(
		{
			error: {
				code: "MULTIMODAL_INGESTION_DISABLED",
				message: "Uploaded knowledge ingestion is not enabled on this deployment.",
			},
		},
		{ status: 503 },
	);
}

function safeFilename(name: string): string {
	const cleaned = name
		.normalize("NFKC")
		.replace(/[\\/]+/g, "_")
		.replace(/[^\p{L}\p{N}._ -]+/gu, "_")
		.trim()
		.slice(0, 160);
	return cleaned || "upload";
}

function knowledgeCallbackUrl(): string | null {
	const raw = process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
	if (!raw) return null;
	try {
		const base = new URL(raw);
		if (process.env.NODE_ENV === "production" && base.protocol !== "https:") return null;
		if (!["https:", "http:"].includes(base.protocol)) return null;
		base.pathname = "/api/knowledge/callback";
		base.search = "";
		base.hash = "";
		return base.toString();
	} catch {
		return null;
	}
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	if (process.env.MULTIMODAL_INGESTION_ENABLED !== "true") return disabled();
	const assets = await listKnowledgeAssets(session.user.id, 50);
	return Response.json({ assets });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	if (process.env.MULTIMODAL_INGESTION_ENABLED !== "true") return disabled();
	const callbackUrl = knowledgeCallbackUrl();
	if (!knowledgeStorageConfigured() || !callbackUrl || !process.env.AIRA_KNOWLEDGE_WORKER_TOKEN?.trim()) {
		return Response.json(
			{ error: { code: "KNOWLEDGE_PIPELINE_UNCONFIGURED", message: "Knowledge ingestion is not fully configured." } },
			{ status: 503 },
		);
	}

	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		return Response.json({ error: { code: "INVALID_FORM", message: "Expected multipart form data." } }, { status: 400 });
	}
	const file = form.get("file");
	if (!(file instanceof File)) {
		return Response.json({ error: { code: "FILE_REQUIRED", message: "A file is required." } }, { status: 400 });
	}
	if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
		return Response.json(
			{ error: { code: "FILE_SIZE_REJECTED", message: "File must be between 1 byte and 20 MB." } },
			{ status: 413 },
		);
	}
	if (!ALLOWED_MIME_TYPES.has(file.type)) {
		return Response.json(
			{ error: { code: "MIME_TYPE_REJECTED", message: "This file type is not supported." } },
			{ status: 415 },
		);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const assetId = randomUUID();
	const filename = safeFilename(file.name);
	const storageKey = `${session.user.id}/${assetId}/${filename}`;

	await createKnowledgeAsset({
		id: assetId,
		userId: session.user.id,
		filename,
		mimeType: file.type,
		sizeBytes: file.size,
		sha256,
		storageKey,
		metadata: { source: "user-upload" },
	});

	try {
		await uploadKnowledgeObject({ storageKey, mimeType: file.type, bytes });
		const signedUrl = await createKnowledgeSignedUrl(storageKey, 3600);
		await updateKnowledgeAssetStatus({
			assetId,
			userId: session.user.id,
			status: "QUEUED",
		});
		const jobId = await enqueueFoundationJob({
			type: "knowledge.ingest",
			payload: {
				assetId,
				userId: session.user.id,
				filename,
				mimeType: file.type,
				signedUrl,
				callbackUrl,
			},
		});
		return Response.json({ assetId, jobId, status: "QUEUED" }, { status: 202 });
	} catch (error) {
		await updateKnowledgeAssetStatus({
			assetId,
			userId: session.user.id,
			status: "FAILED",
			errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Ingestion failed.",
		}).catch(() => undefined);
		await deleteKnowledgeObject(storageKey).catch(() => undefined);
		return Response.json(
			{ error: { code: "INGESTION_ENQUEUE_FAILED", message: "The file could not be queued for ingestion." } },
			{ status: 503 },
		);
	}
}

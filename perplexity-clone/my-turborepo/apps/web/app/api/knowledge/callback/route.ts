import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
	replaceKnowledgeChunks,
	updateKnowledgeAssetStatus,
} from "@/lib/knowledge-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CallbackSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("completed"),
		assetId: z.string().uuid(),
		userId: z.string().min(3).max(128),
		chunks: z
			.array(
				z.object({
					ordinal: z.number().int().min(0).max(10000),
					content: z.string().trim().min(1).max(12_000),
					metadata: z.record(z.string(), z.unknown()).optional(),
				}),
			)
			.min(1)
			.max(256),
	}),
	z.object({
		status: z.literal("failed"),
		assetId: z.string().uuid(),
		userId: z.string().min(3).max(128),
		error: z.string().trim().min(1).max(500),
	}),
]);

function validWorkerToken(req: Request): boolean {
	const expected = process.env.AIRA_KNOWLEDGE_WORKER_TOKEN?.trim();
	const supplied = req.headers.get("x-aira-worker-token")?.trim();
	if (!expected || !supplied) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(supplied);
	return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
	if (!validWorkerToken(req)) {
		return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid worker token." } }, { status: 401 });
	}
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = CallbackSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid callback payload." } }, { status: 400 });
	}

	if (parsed.data.status === "failed") {
		await updateKnowledgeAssetStatus({
			assetId: parsed.data.assetId,
			userId: parsed.data.userId,
			status: "FAILED",
			errorMessage: parsed.data.error,
		});
		return Response.json({ ok: true });
	}

	await updateKnowledgeAssetStatus({
		assetId: parsed.data.assetId,
		userId: parsed.data.userId,
		status: "PROCESSING",
	});
	try {
		await replaceKnowledgeChunks({
			assetId: parsed.data.assetId,
			userId: parsed.data.userId,
			chunks: parsed.data.chunks,
		});
		await updateKnowledgeAssetStatus({
			assetId: parsed.data.assetId,
			userId: parsed.data.userId,
			status: "READY",
		});
		return Response.json({ ok: true });
	} catch (error) {
		await updateKnowledgeAssetStatus({
			assetId: parsed.data.assetId,
			userId: parsed.data.userId,
			status: "FAILED",
			errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Chunk persistence failed.",
		}).catch(() => undefined);
		return Response.json({ error: { code: "CHUNK_PERSISTENCE_FAILED", message: "Could not persist extracted knowledge." } }, { status: 500 });
	}
}

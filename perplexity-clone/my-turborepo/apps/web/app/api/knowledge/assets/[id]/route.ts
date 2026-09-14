import { auth } from "@/auth";
import { deleteKnowledgeAsset, getKnowledgeAsset } from "@/lib/knowledge-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { id } = await context.params;
	if (!id || typeof id !== "string") {
		return Response.json(
			{ error: { code: "INVALID_ID", message: "Asset ID is required." } },
			{ status: 400 },
		);
	}

	const asset = await getKnowledgeAsset(session.user.id, id);
	if (!asset) {
		return Response.json(
			{ error: { code: "NOT_FOUND", message: "Knowledge asset not found." } },
			{ status: 404 },
		);
	}

	return Response.json({
		asset: {
			id: asset.id,
			filename: asset.filename,
			mimeType: asset.mimeType,
			sizeBytes: Number(asset.sizeBytes),
			status: asset.status,
			errorMessage: asset.errorMessage,
			createdAt: asset.createdAt.toISOString(),
			updatedAt: asset.updatedAt.toISOString(),
			sampleText: asset.sampleText,
			chunkCount: asset.chunkCount,
		},
	});
}

export async function DELETE(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const { id } = await context.params;
	if (!id || typeof id !== "string") {
		return Response.json(
			{ error: { code: "INVALID_ID", message: "Asset ID is required." } },
			{ status: 400 },
		);
	}

	const deleted = await deleteKnowledgeAsset(session.user.id, id);
	if (!deleted) {
		return Response.json(
			{ error: { code: "NOT_FOUND", message: "Knowledge asset not found or unauthorized." } },
			{ status: 404 },
		);
	}

	return Response.json({ success: true, deletedId: id });
}

import { z } from "zod";
import { auth } from "@/auth";
import { globalArtifactEngine } from "@/lib/artifacts/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const { id } = await context.params;
	const artifact = await globalArtifactEngine.getArtifactAsync(session.user.id, id);
	if (!artifact) return json({ error: { code: "NOT_FOUND", message: "Artifact not found." } }, { status: 404 });
	return json({ artifact });
}

export async function PUT(
	req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const { id } = await context.params;
	const body = (await req.json().catch(() => null)) as {
		content?: string;
		provenance?: {
			runId: string;
			taskId?: string;
			agentRole?: string;
			parentArtifactId?: string;
			codeSha?: string;
			promptVersionId?: string;
			inputChecksum: string;
			generator: string;
		};
	} | null;

	if (!body?.content || !body?.provenance) {
		return json({ error: { code: "BAD_REQUEST", message: "content and provenance are required." } }, { status: 400 });
	}

	const updated = await globalArtifactEngine.updateArtifactVersionAsync({
		userId: session.user.id,
		artifactId: id,
		content: body.content,
		provenance: body.provenance,
	});

	if (!updated) return json({ error: { code: "NOT_FOUND", message: "Artifact not found or unauthorized." } }, { status: 404 });
	return json({ artifact: updated });
}

export async function DELETE(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const { id } = await context.params;
	const deleted = await globalArtifactEngine.deleteArtifactAsync(session.user.id, id);
	if (!deleted) return json({ error: { code: "NOT_FOUND", message: "Artifact not found or unauthorized." } }, { status: 404 });
	return json({ deleted: true });
}

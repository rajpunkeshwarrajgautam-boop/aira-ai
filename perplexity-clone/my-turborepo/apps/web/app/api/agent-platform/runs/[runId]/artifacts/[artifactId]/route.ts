import { auth } from "@/auth";
import { getRunArtifact } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string; artifactId: string }> };

function json(body: unknown, init?: ResponseInit): Response {
	const serialized = JSON.stringify(body, (_key, value) => typeof value === "bigint" ? Number(value) : value);
	return new Response(serialized, {
		...init,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...(init?.headers ?? {}),
		},
	});
}

export async function GET(_: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const { runId, artifactId } = await params;
	const artifact = await getRunArtifact(session.user.id, runId, artifactId);
	if (!artifact) {
		return json({ error: { code: "NOT_FOUND", message: "Artifact not found or unauthorized." } }, { status: 404 });
	}

	return json({
		artifact: {
			id: artifact.id,
			projectId: artifact.projectId,
			runId: artifact.runId,
			taskId: artifact.taskId,
			kind: artifact.kind,
			name: artifact.name,
			uri: artifact.uri,
			content: typeof artifact.metadata.content === "string" ? artifact.metadata.content : null,
			metadata: artifact.metadata,
			createdAt: artifact.createdAt,
		},
	});
}

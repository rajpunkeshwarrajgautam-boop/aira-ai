import { z } from "zod";
import { auth } from "@/auth";
import { globalArtifactEngine, type ArtifactFormat } from "@/lib/artifacts/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const CreateArtifactInputSchema = z.object({
	projectId: z.string().optional(),
	name: z.string().min(1).max(120),
	format: z.enum(["TXT", "MARKDOWN", "JSON", "CSV", "HTML", "PDF", "DOCX", "XLSX", "PPTX", "ZIP", "DOCX_OUTLINE", "PPTX_DECK", "ZIP_METADATA", "IMAGE_METADATA"]),
	content: z.string().min(1),
	provenance: z.object({
		runId: z.string().min(1),
		taskId: z.string().optional(),
		agentRole: z.string().optional(),
		parentArtifactId: z.string().optional(),
		codeSha: z.string().optional(),
		promptVersionId: z.string().optional(),
		inputChecksum: z.string().default("direct_input"),
		generator: z.string().default("aira_agent"),
	}),
	tags: z.array(z.string()).default([]),
});

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const { searchParams } = new URL(req.url);
	const projectId = searchParams.get("projectId") ?? undefined;
	const artifacts = globalArtifactEngine.listArtifacts(session.user.id, projectId);
	return json({ artifacts });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const body = await req.json().catch(() => null);
	const parsed = CreateArtifactInputSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid artifact creation payload.", details: parsed.error.format() } }, { status: 400 });
	}

	const artifact = globalArtifactEngine.createArtifact({
		userId: session.user.id,
		...parsed.data,
	});

	return json({ artifact }, { status: 201 });
}

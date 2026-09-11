import { z } from "zod";
import { auth } from "@/auth";
import { globalFederatedKnowledge } from "@/lib/federated-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

const FederatedQuerySchema = z.object({
	query: z.string().min(1).max(1000),
	projectId: z.string().optional(),
	sources: z.array(z.enum(["KNOWLEDGE_ASSET", "PERSISTENT_MEMORY", "GOOGLE_DRIVE", "SLACK", "GMAIL", "NOTION"])).optional(),
	minScore: z.number().min(0).max(1).optional(),
	limit: z.number().min(1).max(50).optional(),
});

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const body = await req.json().catch(() => null);
	const parsed = FederatedQuerySchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid federated search query.", details: parsed.error.format() } }, { status: 400 });
	}

	const result = await globalFederatedKnowledge.search({
		userId: session.user.id,
		...parsed.data,
	});

	return json({ result });
}

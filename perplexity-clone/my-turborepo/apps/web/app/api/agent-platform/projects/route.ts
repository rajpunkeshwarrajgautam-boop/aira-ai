import { z } from "zod";

import { auth } from "@/auth";
import { createProject, listProjects } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateProjectSchema = z.object({
	name: z.string().trim().min(2).max(120),
	objective: z.string().trim().min(3).max(8_000),
	config: z.record(z.string(), z.unknown()).optional(),
});

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	return json({ projects: await listProjects(session.user.id) });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const body = await req.json().catch(() => null);
	const parsed = CreateProjectSchema.safeParse(body);
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Provide a project name and objective.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	const project = await createProject({ userId: session.user.id, ...parsed.data });
	return json({ project }, { status: 201 });
}

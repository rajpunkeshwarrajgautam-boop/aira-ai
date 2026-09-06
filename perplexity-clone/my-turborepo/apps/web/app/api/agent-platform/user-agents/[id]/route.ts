import { z } from "zod";
import { auth } from "@/auth";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";

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
	const agent = globalUserAgentStore.getAgent(session.user.id, id);
	if (!agent) return json({ error: { code: "NOT_FOUND", message: "Agent not found." } }, { status: 404 });
	return json({ agent });
}

export async function PUT(
	req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const body = await req.json().catch(() => null);
	if (!body || typeof body !== "object") return json({ error: { code: "BAD_REQUEST", message: "Invalid payload." } }, { status: 400 });

	const updated = globalUserAgentStore.updateAgent(session.user.id, id, body);
	if (!updated) return json({ error: { code: "NOT_FOUND", message: "Agent not found or unauthorized." } }, { status: 404 });
	return json({ agent: updated });
}

export async function DELETE(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const deleted = globalUserAgentStore.deleteAgent(session.user.id, id);
	if (!deleted) return json({ error: { code: "NOT_FOUND", message: "Agent not found or unauthorized." } }, { status: 404 });
	return json({ deleted: true });
}

import { z } from "zod";
import { auth } from "@/auth";
import { globalSkillsStore } from "@/lib/agents/installable-skills-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await context.params;
	const skill = globalSkillsStore.getSkill(id);
	if (!skill) return json({ error: { code: "NOT_FOUND", message: "Skill not found." } }, { status: 404 });
	return json({ skill });
}

export async function PATCH(
	req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
	if (typeof body?.enabled !== "boolean") {
		return json({ error: { code: "BAD_REQUEST", message: "Field 'enabled' (boolean) is required." } }, { status: 400 });
	}

	const ok = globalSkillsStore.toggleSkill(id, body.enabled);
	if (!ok) return json({ error: { code: "NOT_FOUND", message: "Skill not found." } }, { status: 404 });
	return json({ updated: true, enabled: body.enabled });
}

export async function DELETE(
	_req: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { id } = await context.params;
	const deleted = globalSkillsStore.uninstallSkill(session.user.id, id);
	if (!deleted) return json({ error: { code: "NOT_FOUND", message: "Skill not found or cannot be deleted." } }, { status: 404 });
	return json({ deleted: true });
}

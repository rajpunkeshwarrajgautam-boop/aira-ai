import { z } from "zod";

import { auth } from "@/auth";
import { UserMemoryKind } from "@/generated/prisma/enums";
import {
	createManualMemory,
	deleteUserMemory,
	listUserMemories,
	setUserMemoryPinned,
} from "@/lib/persistent-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateMemorySchema = z.object({
	content: z.string().trim().min(3).max(600),
	kind: z
		.enum(["PROFILE", "PREFERENCE", "GOAL", "PROJECT", "DECISION", "CONSTRAINT", "RELATIONSHIP", "OTHER"])
		.optional(),
	pinned: z.boolean().optional().default(true),
});

const UpdateMemorySchema = z.object({
	id: z.string().min(3).max(128),
	pinned: z.boolean(),
});

const DeleteMemorySchema = z.object({
	id: z.string().min(3).max(128),
});

function unauthenticated(): Response {
	return Response.json(
		{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
		{ status: 401 },
	);
}

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	const url = new URL(req.url);
	const limit = Number(url.searchParams.get("limit") ?? "100");
	const memories = await listUserMemories(
		session.user.id,
		Number.isFinite(limit) ? limit : 100,
	);
	return Response.json({ memories });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = CreateMemorySchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ error: { code: "VALIDATION_ERROR", message: "Invalid memory.", details: z.treeifyError(parsed.error) } },
			{ status: 400 },
		);
	}
	try {
		const memory = await createManualMemory({
			userId: session.user.id,
			content: parsed.data.content,
			kind: parsed.data.kind ? (parsed.data.kind as UserMemoryKind) : undefined,
			pinned: parsed.data.pinned,
		});
		return Response.json({ memory }, { status: 201 });
	} catch (error) {
		return Response.json(
			{ error: { code: "MEMORY_REJECTED", message: error instanceof Error ? error.message : "Memory could not be saved." } },
			{ status: 400 },
		);
	}
}

export async function PATCH(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = UpdateMemorySchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } }, { status: 400 });
	}
	const updated = await setUserMemoryPinned(session.user.id, parsed.data.id, parsed.data.pinned);
	if (!updated) {
		return Response.json({ error: { code: "NOT_FOUND", message: "Memory not found." } }, { status: 404 });
	}
	return Response.json({ ok: true });
}

export async function DELETE(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return unauthenticated();
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = DeleteMemorySchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } }, { status: 400 });
	}
	const deleted = await deleteUserMemory(session.user.id, parsed.data.id);
	if (!deleted) {
		return Response.json({ error: { code: "NOT_FOUND", message: "Memory not found." } }, { status: 404 });
	}
	return Response.json({ ok: true });
}

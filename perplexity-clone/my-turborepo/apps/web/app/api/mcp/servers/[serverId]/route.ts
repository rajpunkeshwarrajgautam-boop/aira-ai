import { z } from "zod";

import { auth } from "@/auth";
import { McpRuntimeError, setMcpServerEnabled } from "@/lib/mcp/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ serverId: string }> };

const ToggleSchema = z.object({ enabled: z.boolean() });

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return noStoreJson(
			{ error: { code: "INVALID_REQUEST", message: "MCP preference must be valid JSON." } },
			{ status: 400 },
		);
	}
	const parsed = ToggleSchema.safeParse(raw);
	if (!parsed.success) {
		return noStoreJson(
			{ error: { code: "INVALID_REQUEST", message: "enabled must be a boolean." } },
			{ status: 400 },
		);
	}
	const { serverId } = await params;
	try {
		const enabled = await setMcpServerEnabled(session.user.id, serverId, parsed.data.enabled);
		return noStoreJson({ serverId, enabled });
	} catch (error) {
		if (error instanceof McpRuntimeError) {
			const status = error.code === "MCP_SERVER_NOT_FOUND" ? 404 : error.code === "MCP_SERVER_DISABLED" ? 409 : 400;
			return noStoreJson({ error: { code: error.code, message: error.message } }, { status });
		}
		console.error("[mcp:preference]", {
			serverId,
			code: "MCP_PREFERENCE_FAILED",
		});
		return noStoreJson(
			{ error: { code: "MCP_PREFERENCE_FAILED", message: "MCP preference could not be saved." } },
			{ status: 500 },
		);
	}
}

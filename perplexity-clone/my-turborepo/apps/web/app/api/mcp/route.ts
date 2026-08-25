import { auth } from "@/auth";
import { isMcpEnabled } from "@/lib/mcp/config";
import { getMcpServerStatuses } from "@/lib/mcp/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}
	try {
		return noStoreJson({
			enabled: isMcpEnabled(),
			servers: await getMcpServerStatuses(session.user.id),
		});
	} catch (error) {
		console.error("[mcp:status]", {
			code: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "MCP_STATUS_FAILED",
		});
		return noStoreJson(
			{ error: { code: "MCP_STATUS_FAILED", message: "MCP status could not be loaded." } },
			{ status: 500 },
		);
	}
}

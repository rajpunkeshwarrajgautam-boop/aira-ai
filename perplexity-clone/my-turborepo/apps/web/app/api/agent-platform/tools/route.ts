import { auth } from "@/auth";
import { registeredToolIds, toolAvailability } from "@/lib/tool-gateway/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const availability = await toolAvailability();
	const tools = registeredToolIds().map((id) => ({
		id,
		registered: true,
		available: availability[id] === true,
	}));

	return json({
		tools,
		availableCount: tools.filter((tool) => tool.available).length,
		registeredCount: tools.length,
		checkedAt: new Date().toISOString(),
	});
}

import { auth } from "@/auth";
import { listTasksForUser } from "@/lib/agent-platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const url = new URL(req.url);
	const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
	const tasks = await listTasksForUser(session.user.id, limit);

	return json({ tasks, count: tasks.length });
}

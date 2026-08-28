import { advanceScheduledRuns } from "@/lib/agent-platform/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
	const expected = process.env.AIRA_AGENT_SCHEDULER_TOKEN?.trim();
	if (!expected || expected.length < 24) return false;
	const authorization = req.headers.get("authorization") ?? "";
	if (!authorization.toLowerCase().startsWith("bearer ")) return false;
	const supplied = authorization.slice(7).trim();
	if (supplied.length !== expected.length) return false;
	let mismatch = 0;
	for (let index = 0; index < expected.length; index += 1) {
		mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
	}
	return mismatch === 0;
}

export async function POST(req: Request): Promise<Response> {
	if (!authorized(req)) {
		return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized scheduler request." } }, { status: 401 });
	}
	const requested = Number(new URL(req.url).searchParams.get("limit") ?? "8");
	const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.trunc(requested))) : 8;
	const result = await advanceScheduledRuns(limit);
	return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

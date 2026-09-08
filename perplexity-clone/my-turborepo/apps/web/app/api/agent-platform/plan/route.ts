import { auth } from "@/auth";
import { MissionInput } from "@/lib/contracts/mission";
import { globalCapabilityPlanner } from "@/lib/agents/capability-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });

	const body = await req.json().catch(() => null);
	const candidate = body && typeof body === "object" && !Array.isArray(body)
		? { ...body, userId: session.user.id }
		: { userId: session.user.id };
	const parsed = MissionInput.safeParse(candidate);
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Invalid mission specification.", details: parsed.error.format() } }, { status: 400 });
	}

	const plan = globalCapabilityPlanner.plan(parsed.data);

	return json({ plan });
}

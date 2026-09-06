import { auth } from "@/auth";
import { globalAutomationEngine, RoutineDefinitionSchema } from "@/lib/automation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	const routines = globalAutomationEngine.listUserRoutines(session.user.id);
	const templates = globalAutomationEngine.templates;

	return json({
		routines,
		templates,
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const routine = globalAutomationEngine.createRoutine({
			...body,
			userId: session.user.id,
		});
		return json({ routine }, { status: 201 });
	} catch (error) {
		return json(
			{
				error: {
					code: "INVALID_ROUTINE_DEFINITION",
					message: error instanceof Error ? error.message : "Failed to create routine.",
				},
			},
			{ status: 400 },
		);
	}
}

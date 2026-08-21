import { auth } from "@/auth";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";
import { LeadWorkerInputSchema, runLeadWorker } from "@services/local-ai/business-workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = LeadWorkerInputSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Lead notes are required." } }, { status: 400 });
	}
	await assertSafetyAllowed("input", `${parsed.data.name}\n${parsed.data.company}\n${parsed.data.role}\n${parsed.data.notes}`);
	try {
		const result = await runLeadWorker(parsed.data);
		await assertSafetyAllowed("output", JSON.stringify(result.data));
		return Response.json(result, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return Response.json(
			{ error: { code: "LEAD_WORKER_FAILED", message: error instanceof Error ? error.message.slice(0, 500) : "Lead worker failed." } },
			{ status: 502, headers: { "Cache-Control": "no-store" } },
		);
	}
}

import { auth } from "@/auth";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";
import { EmailWorkerInputSchema, runEmailWorker } from "@services/local-ai/business-workers";

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
	const parsed = EmailWorkerInputSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Email body is required." } }, { status: 400 });
	}
	await assertSafetyAllowed("input", `${parsed.data.from}\n${parsed.data.subject}\n${parsed.data.body}`);
	try {
		const result = await runEmailWorker(parsed.data);
		return Response.json(result, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return Response.json(
			{ error: { code: "EMAIL_WORKER_FAILED", message: error instanceof Error ? error.message.slice(0, 500) : "Email worker failed." } },
			{ status: 502, headers: { "Cache-Control": "no-store" } },
		);
	}
}

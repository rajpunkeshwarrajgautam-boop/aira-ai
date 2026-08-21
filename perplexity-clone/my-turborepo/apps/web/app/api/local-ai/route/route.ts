import { z } from "zod";

import { auth } from "@/auth";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";
import { getLocalAiConfig } from "@services/local-ai/config";
import { routeLocalAiTask } from "@services/local-ai/task-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
	prompt: z.string().trim().min(2).max(20_000),
	taskKind: z.enum(["chat", "summarize", "rewrite", "extract", "classify", "lead", "email", "rag", "code", "research", "unknown"]).optional(),
});

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
	const parsed = Schema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid routing request." } }, { status: 400 });
	}
	await assertSafetyAllowed("input", parsed.data.prompt);
	const config = getLocalAiConfig();
	const decision = routeLocalAiTask({
		prompt: parsed.data.prompt,
		taskKind: parsed.data.taskKind,
		localFirst: config.localFirst,
	});
	return Response.json(
		{
			decision,
			localConfigured: config.configured,
			effectiveTier: decision.tier === "local" && !config.configured ? "cloud" : decision.tier,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

import { z } from "zod";

import { auth } from "@/auth";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { OmniRouteProvider } from "@services/providers/omniroute-provider";
import { assertSafetyAllowed } from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TestSchema = z.object({
	model: z.string().trim().min(1).max(500).optional(),
	prompt: z.string().trim().min(1).max(4_000).optional(),
});

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	let body: unknown = {};
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: { code: "INVALID_JSON", message: "Body must be valid JSON." } }, { status: 400 });
	}
	const parsed = TestSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid OmniRoute test request." } }, { status: 400 });
	}

	const config = getOmniRouteConfigOrDisabled();
	if (!config.configured) {
		return Response.json(
			{ error: { code: "OMNIROUTE_NOT_CONFIGURED", message: "OmniRoute is not configured." } },
			{ status: 503 },
		);
	}

	const prompt = parsed.data.prompt ?? "Reply with one short sentence confirming that the AIRA OmniRoute gateway is working.";
	await assertSafetyAllowed("input", prompt);
	const model = parsed.data.model ?? config.model;
	const provider = new OmniRouteProvider({ baseURL: config.baseURL, apiKey: config.apiKey, model });
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	const startedAt = Date.now();
	try {
		let text = "";
		for await (const delta of provider.generateTextStream(
			[
				{ role: "system", content: "You are running a connectivity test for AIRA. Answer directly and briefly." },
				{ role: "user", content: prompt },
			],
			{ model, temperature: 0.1, maxCompletionTokens: 240, abortSignal: controller.signal },
		)) {
			text += delta;
		}
		await assertSafetyAllowed("output", text);
		return Response.json(
			{ ok: true, model, text: text.trim(), latencyMs: Date.now() - startedAt },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		return Response.json(
			{
				ok: false,
				model,
				error: error instanceof Error ? error.message.slice(0, 500) : "OmniRoute inference test failed.",
			},
			{ status: 502, headers: { "Cache-Control": "no-store" } },
		);
	} finally {
		clearTimeout(timeout);
	}
}

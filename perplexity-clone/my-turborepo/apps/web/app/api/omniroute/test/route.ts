import { z } from "zod";

import { auth } from "@/auth";
import { isOmniRoutePreviewTestAccessEnabled } from "@/lib/omniroute-preview-access";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels, OmniRouteGatewayError } from "@services/omniroute/gateway";
import { isAllowedOmniRouteSelection, isOmniRouteRoutingMode } from "@services/omniroute/routing";
import { OmniRouteProvider } from "@services/providers/omniroute-provider";
import {
	assertSafetyAllowed,
	SafetyBlockedError,
	SafetyGatewayError,
} from "@services/safety/safety-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TestSchema = z.object({
	model: z.string().trim().min(1).max(500).optional(),
	prompt: z.string().trim().min(1).max(4_000).optional(),
});

const MAX_TEST_OUTPUT_CHARS = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
	const now = Date.now();
	if (rateBuckets.size > 5_000) {
		for (const [key, bucket] of rateBuckets) {
			if (bucket.resetAt <= now) rateBuckets.delete(key);
		}
	}
	const current = rateBuckets.get(userId);
	if (!current || current.resetAt <= now) {
		rateBuckets.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return { allowed: true };
	}
	if (current.count >= RATE_LIMIT) {
		return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
	}
	current.count += 1;
	return { allowed: true };
}

function errorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
	const status = (error as { readonly status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function publicInferenceError(error: unknown, requestAborted: boolean): {
	status: number;
	code: string;
	message: string;
	upstreamStatus?: number;
} {
	if (error instanceof SafetyBlockedError) {
		return { status: 400, code: "SAFETY_BLOCKED", message: error.message };
	}
	if (error instanceof SafetyGatewayError) {
		return { status: 503, code: "SAFETY_UNAVAILABLE", message: "AIRA's safety gateway is unavailable." };
	}
	if (error instanceof OmniRouteGatewayError) {
		return {
			status: error.code === "OMNIROUTE_TIMEOUT" ? 504 : 502,
			code: error.code,
			message: error.message,
			...(error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}),
		};
	}
	if (requestAborted || (error instanceof Error && error.name === "AbortError")) {
		return { status: 504, code: "OMNIROUTE_TIMEOUT", message: "The OmniRoute test request was cancelled or timed out." };
	}
	const upstreamStatus = errorStatus(error);
	if (upstreamStatus === 401 || upstreamStatus === 403) {
		return { status: 502, code: "OMNIROUTE_AUTH_REJECTED", message: "OmniRoute rejected AIRA's gateway credentials.", upstreamStatus };
	}
	if (upstreamStatus === 404) {
		return { status: 400, code: "OMNIROUTE_MODEL_UNAVAILABLE", message: "The selected OmniRoute model is unavailable.", upstreamStatus };
	}
	if (upstreamStatus === 429) {
		return { status: 429, code: "OMNIROUTE_RATE_LIMITED", message: "OmniRoute is temporarily rate limited.", upstreamStatus };
	}
	return { status: 502, code: "OMNIROUTE_INFERENCE_FAILED", message: "OmniRoute inference failed.", ...(upstreamStatus ? { upstreamStatus } : {}) };
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	const userId = session?.user?.id ?? (isOmniRoutePreviewTestAccessEnabled() ? "preview-omniroute-tester" : undefined);
	if (!userId) {
		return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}

	const rate = checkRateLimit(userId);
	if (!rate.allowed) {
		return Response.json(
			{ error: { code: "RATE_LIMITED", message: "Too many OmniRoute test requests. Try again shortly." } },
			{ status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfterSeconds) } },
		);
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
			{ error: { code: "OMNIROUTE_NOT_CONFIGURED", message: config.configurationError ?? "OmniRoute is not configured." } },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}

	const prompt = parsed.data.prompt ?? "Reply with one short sentence confirming that the AIRA OmniRoute gateway is working.";
	const model = parsed.data.model ?? config.model;
	const startedAt = Date.now();
	try {
		await assertSafetyAllowed("input", prompt);
		if (!isOmniRouteRoutingMode(model)) {
			const snapshot = await fetchOmniRouteModels(req.signal);
			if (!isAllowedOmniRouteSelection(model, snapshot.models.map((entry) => entry.id))) {
				return Response.json(
					{ error: { code: "OMNIROUTE_MODEL_NOT_DISCOVERED", message: "Select a model from the current OmniRoute registry." } },
					{ status: 400, headers: { "Cache-Control": "no-store" } },
				);
			}
		}

		const provider = new OmniRouteProvider({
			baseURL: config.baseURL,
			apiKey: config.apiKey,
			model,
			timeoutMs: config.timeoutMs,
		});
		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
		const signal = AbortSignal.any([req.signal, timeoutController.signal]);
		try {
			let text = "";
			for await (const delta of provider.generateTextStream(
				[
					{ role: "system", content: "You are running a connectivity test for AIRA. Answer directly and briefly." },
					{ role: "user", content: prompt },
				],
				{ model, temperature: 0.1, maxCompletionTokens: 240, abortSignal: signal },
			)) {
				text += delta;
				if (text.length > MAX_TEST_OUTPUT_CHARS) {
					timeoutController.abort();
					throw new Error("OMNIROUTE_TEST_OUTPUT_LIMIT");
				}
			}
			await assertSafetyAllowed("output", text);
			const latencyMs = Date.now() - startedAt;
			console.info("[OmniRoute]", JSON.stringify({ event: "test_success", provider: "omniroute", model, latencyMs }));
			return Response.json(
				{ ok: true, model, text: text.trim(), latencyMs },
				{ headers: { "Cache-Control": "no-store" } },
			);
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		const classified = error instanceof Error && error.message === "OMNIROUTE_TEST_OUTPUT_LIMIT"
			? { status: 502, code: "OMNIROUTE_OUTPUT_TOO_LARGE", message: "OmniRoute returned an unexpectedly large test response." }
			: publicInferenceError(error, req.signal.aborted);
		console.warn("[OmniRoute]", JSON.stringify({
			event: "test_failure",
			provider: "omniroute",
			model,
			latencyMs: Date.now() - startedAt,
			code: classified.code,
			...("upstreamStatus" in classified && classified.upstreamStatus ? { upstreamStatus: classified.upstreamStatus } : {}),
		}));
		return Response.json(
			{ ok: false, model, error: { code: classified.code, message: classified.message } },
			{ status: classified.status, headers: { "Cache-Control": "no-store" } },
		);
	}
}

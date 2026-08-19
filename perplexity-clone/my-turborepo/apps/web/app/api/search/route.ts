import { POST as corePost } from "./route-core";

import {
	normalizeAndGuardUserQuery,
	RequestGuardError,
} from "@services/runtime/request-guard";
import { AiraRuntimeTrace } from "@services/runtime/runtime-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function withRequestId(response: Response, requestId: string): Response {
	const headers = new Headers(response.headers);
	headers.set("X-AIRA-Request-Id", requestId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function guardedError(error: RequestGuardError, requestId: string): Response {
	return Response.json(
		{
			error: {
				code: error.code,
				message: error.message,
			},
		},
		{
			status: error.status,
			headers: {
				"Cache-Control": "no-store",
				"X-AIRA-Request-Id": requestId,
			},
		},
	);
}

/**
 * Thin ingress boundary around the proven search route.
 *
 * This wrapper owns request correlation and conservative text hygiene only. Billing,
 * authentication, retrieval, streaming, persistence, analytics, and product behavior
 * remain in route-core.ts so the runtime hardening does not duplicate business logic.
 */
export async function POST(req: Request): Promise<Response> {
	const trace = new AiraRuntimeTrace(
		req.headers.get("x-aira-request-id") ?? req.headers.get("x-request-id"),
	);
	trace.mark("ingress", {
		method: req.method,
		contentType: req.headers.get("content-type")?.slice(0, 80) ?? null,
	});

	let forwarded = req;
	try {
		const body = (await req.clone().json()) as unknown;
		if (typeof body === "object" && body !== null && "query" in body) {
			const record = body as Record<string, unknown>;
			if (typeof record.query === "string") {
				const normalizedQuery = normalizeAndGuardUserQuery(record.query);
				const normalizedBody = { ...record, query: normalizedQuery };
				forwarded = new Request(req.url, {
					method: req.method,
					headers: req.headers,
					body: JSON.stringify(normalizedBody),
					signal: req.signal,
				});
				trace.mark("request_guard_passed", {
					queryChars: normalizedQuery.length,
				});
			}
		}
	} catch (error) {
		if (error instanceof RequestGuardError) {
			trace.finish("error", { code: error.code, status: error.status });
			return guardedError(error, trace.requestId);
		}
		// Invalid JSON and schema/type errors remain the core route's responsibility.
		trace.mark("request_guard_deferred");
	}

	try {
		const response = await corePost(forwarded);
		trace.mark("core_response_ready", {
			status: response.status,
			streaming: response.headers.get("content-type")?.includes("text/event-stream") ?? false,
		});
		return withRequestId(response, trace.requestId);
	} catch (error) {
		trace.finish("error", {
			code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
		});
		throw error;
	}
}

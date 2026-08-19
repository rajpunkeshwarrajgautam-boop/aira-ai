import { POST as corePost } from "./route-core";

import {
	admitFoundationRequest,
	releaseFoundationLease,
	type AdmissionLease,
} from "@/lib/foundation-control-plane";
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

function admissionRejected(lease: AdmissionLease, requestId: string): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((lease.retryAfterMs ?? 1000) / 1000));
	return Response.json(
		{
			error: {
				code: "CAPACITY_BUSY",
				message: "AIRA is at its current safe processing capacity. Please retry shortly.",
			},
		},
		{
			status: 503,
			headers: {
				"Cache-Control": "no-store",
				"Retry-After": String(retryAfterSeconds),
				"X-AIRA-Request-Id": requestId,
			},
		},
	);
}

function releaseWhenBodyCompletes(response: Response, leaseId?: string): Response {
	if (!leaseId) return response;
	if (!response.body) {
		void releaseFoundationLease(leaseId);
		return response;
	}
	const [clientBody, observerBody] = response.body.tee();
	void (async () => {
		const reader = observerBody.getReader();
		try {
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		} catch {
			// The lease release below is still required when a stream aborts.
		} finally {
			await releaseFoundationLease(leaseId);
		}
	})();
	return new Response(clientBody, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

export async function POST(req: Request): Promise<Response> {
	const trace = new AiraRuntimeTrace(
		req.headers.get("x-aira-request-id") ?? req.headers.get("x-request-id"),
	);
	trace.mark("ingress", {
		method: req.method,
		contentType: req.headers.get("content-type")?.slice(0, 80) ?? null,
	});

	let forwarded = req;
	let admissionKind: "search" | "deep-research" = "search";
	try {
		const body = (await req.clone().json()) as unknown;
		if (typeof body === "object" && body !== null && "query" in body) {
			const record = body as Record<string, unknown>;
			admissionKind = record.mode === "deep" ? "deep-research" : "search";
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
		trace.mark("request_guard_deferred");
	}

	let lease: AdmissionLease;
	try {
		lease = await admitFoundationRequest({ requestId: trace.requestId, kind: admissionKind });
	} catch (error) {
		trace.finish("error", { code: "CONTROL_PLANE_UNAVAILABLE" });
		return Response.json(
			{ error: { code: "CONTROL_PLANE_UNAVAILABLE", message: "AIRA capacity coordination is temporarily unavailable." } },
			{ status: 503, headers: { "Cache-Control": "no-store", "X-AIRA-Request-Id": trace.requestId } },
		);
	}
	if (!lease.allowed) {
		trace.mark("admission_rejected", { code: "CAPACITY_BUSY", kind: admissionKind });
		trace.finish("error", { code: "CAPACITY_BUSY", kind: admissionKind });
		return admissionRejected(lease, trace.requestId);
	}
	if (lease.degraded) trace.mark("control_plane_degraded");

	try {
		const response = await corePost(forwarded);
		trace.mark("core_response_ready", {
			status: response.status,
			streaming: response.headers.get("content-type")?.includes("text/event-stream") ?? false,
		});
		return withRequestId(releaseWhenBodyCompletes(response, lease.leaseId), trace.requestId);
	} catch (error) {
		await releaseFoundationLease(lease.leaseId);
		trace.finish("error", {
			code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
		});
		throw error;
	}
}

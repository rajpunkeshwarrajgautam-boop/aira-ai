import { handlers } from "@/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function authRequestDiagnostics(request: NextRequest) {
	const url = new URL(request.url);
	const cookieHeader = request.headers.get("cookie") ?? "";

	return {
		method: request.method,
		host: url.host,
		path: url.pathname,
		hasPkceCookie: cookieHeader.includes("__Secure-authjs.pkce.code_verifier="),
		hasSessionCookie:
			cookieHeader.includes("__Secure-authjs.session-token=") ||
			cookieHeader.includes("authjs.session-token="),
	};
}

async function runAuthHandler(
	handler: (request: NextRequest) => Promise<Response>,
	request: NextRequest,
): Promise<Response> {
	const diagnostics = authRequestDiagnostics(request);
	if (diagnostics.path.includes("/callback/") || diagnostics.path.includes("/signin/")) {
		console.info("[auth:request]", diagnostics);
	}

	const response = await handler(request);
	if (diagnostics.path.includes("/callback/") || diagnostics.path.includes("/signin/")) {
		const setCookie = response.headers.get("set-cookie") ?? "";
		console.info("[auth:response]", {
			method: diagnostics.method,
			host: diagnostics.host,
			path: diagnostics.path,
			status: response.status,
			setsPkceCookie: setCookie.includes("__Secure-authjs.pkce.code_verifier="),
			clearsPkceCookie:
				setCookie.includes("__Secure-authjs.pkce.code_verifier=") &&
				setCookie.includes("Max-Age=0"),
		});
	}

	return response;
}

export function GET(request: NextRequest): Promise<Response> {
	return runAuthHandler(handlers.GET, request);
}

export function POST(request: NextRequest): Promise<Response> {
	return runAuthHandler(handlers.POST, request);
}

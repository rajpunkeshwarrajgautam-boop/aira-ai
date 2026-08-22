import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { authConfig } from "./auth.config";
import { isOmniRoutePreviewTestAccessEnabled } from "./lib/omniroute-preview-access";

/**
 * Edge-safe Auth.js instance (no Prisma). Validates JWT session cookie only.
 * OAuth persistence uses `auth.ts` + PrismaAdapter in Node routes.
 */
const { auth } = NextAuth(authConfig);

function canonicalProductionOrigin(): URL | null {
	if (process.env.VERCEL_ENV !== "production") return null;

	const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
	if (!configuredUrl) return null;

	try {
		return new URL(configuredUrl);
	} catch {
		console.error("[auth:canonical-host] AUTH_URL/NEXTAUTH_URL is not a valid URL");
		return null;
	}
}

function jsonUnauthorized(): NextResponse {
	return NextResponse.json(
		{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
		{ status: 401, headers: { "Cache-Control": "no-store" } },
	);
}

const authenticatedProxy = auth((req) => {
	const { pathname } = req.nextUrl;
	const canonicalOrigin = canonicalProductionOrigin();
	const acceptsHtml = req.headers.get("accept")?.includes("text/html") ?? false;

	// OAuth transient cookies are host-scoped. If a user opens a Vercel
	// deployment alias but GitHub returns to AUTH_URL, the PKCE verifier is not
	// available on the callback host and Auth.js rejects the login. Canonicalize
	// browser navigations before rendering a page that can start OAuth.
	if (
		canonicalOrigin &&
		acceptsHtml &&
		(req.method === "GET" || req.method === "HEAD") &&
		req.nextUrl.origin !== canonicalOrigin.origin
	) {
		const canonicalUrl = new URL(
			`${req.nextUrl.pathname}${req.nextUrl.search}`,
			canonicalOrigin.origin,
		);
		return NextResponse.redirect(canonicalUrl, 307);
	}

	if (
		pathname.startsWith("/_next") ||
		pathname === "/favicon.ico" ||
		/\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)
	) {
		return NextResponse.next();
	}

	// Public HTML: guest search, pricing, and read-only share pages.
	// Keep this above the unauthenticated redirect. The common matcher regex often
	// does not match "/" on its own (Next.js #62078), so `config.matcher` also lists "/".
	if (
		pathname === "/" ||
		pathname === "/pricing" ||
		pathname === "/share" ||
		pathname.startsWith("/share/")
	) {
		return NextResponse.next();
	}

	// API: public routes (auth handshake, webhooks, anonymous analytics).
	if (pathname.startsWith("/api/auth")) {
		return NextResponse.next();
	}
	if (pathname.startsWith("/api/webhooks/")) {
		return NextResponse.next();
	}
	if (pathname.startsWith("/api/analytics/")) {
		return NextResponse.next();
	}

	// API: session required (route handlers also enforce; belt + suspenders).
	// POST /api/search: unauthenticated allowed — route enforces standard-only guest flow + daily cap.
	if (
		pathname.startsWith("/api/conversations") ||
		pathname.startsWith("/api/billing") ||
		pathname.startsWith("/api/history") ||
		pathname.startsWith("/api/share")
	) {
		if (!req.auth) {
			return jsonUnauthorized();
		}
		return NextResponse.next();
	}

	if (pathname.startsWith("/api/admin")) {
		if (!req.auth) {
			return jsonUnauthorized();
		}
		return NextResponse.next();
	}

	if (pathname.startsWith("/api/")) {
		return NextResponse.next();
	}

	if (pathname === "/signin") {
		if (req.auth) {
			return NextResponse.redirect(new URL("/", req.url));
		}
		return NextResponse.next();
	}

	if (!req.auth) {
		const signIn = new URL("/signin", req.url);
		signIn.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
		return NextResponse.redirect(signIn);
	}

	return NextResponse.next();
});

/**
 * The OmniRoute preview test gate must run before Auth.js. Preview deployments
 * can intentionally omit OAuth/session secrets while the gateway integration is
 * being validated, and invoking Auth.js first would fail with MissingSecret.
 * This path is impossible in production because the helper requires
 * VERCEL_ENV=preview and the explicit preview-only flag.
 */
export default function proxy(req: NextRequest, event: NextFetchEvent) {
	const { pathname } = req.nextUrl;
	if (
		isOmniRoutePreviewTestAccessEnabled() &&
		(pathname === "/omniroute" || pathname.startsWith("/api/omniroute/"))
	) {
		return NextResponse.next();
	}
	return authenticatedProxy(req, event);
}

export const config = {
	matcher: [
		// Root is often excluded by the catch-all negative-lookahead pattern alone (Vercel / Next.js).
		"/",
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
	],
};

import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "./auth.config";

/**
 * Edge-safe Auth.js instance (no Prisma). Validates JWT session cookie only.
 * OAuth persistence uses `auth.ts` + PrismaAdapter in Node routes.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
	const { pathname } = req.nextUrl;

	if (pathname.startsWith("/api/")) {
		return NextResponse.next();
	}

	if (
		pathname.startsWith("/_next") ||
		pathname === "/favicon.ico" ||
		/\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)
	) {
		return NextResponse.next();
	}

	if (pathname === "/signin") {
		if (req.auth) {
			return NextResponse.redirect(new URL("/", req.url));
		}
		return NextResponse.next();
	}

	// Public read-only share pages (token in URL); no session required.
	if (pathname.startsWith("/share/")) {
		return NextResponse.next();
	}

	if (!req.auth) {
		const signIn = new URL("/signin", req.url);
		signIn.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
		return NextResponse.redirect(signIn);
	}

	return NextResponse.next();
});

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
	],
};

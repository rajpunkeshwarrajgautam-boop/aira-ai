import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { authConfig } from "./auth.config";
import { prisma } from "./lib/prisma";

const resolvedSecret =
	process.env.NEXTAUTH_SECRET ??
	process.env.AUTH_SECRET ??
	(process.env.NODE_ENV !== "production"
		? "development-only-secret-do-not-use-in-production-min-32-chars"
		: undefined);

if (process.env.NODE_ENV === "production") {
	const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			"NEXTAUTH_SECRET (or AUTH_SECRET) must be set to a strong value (at least 32 characters) in production.",
		);
	}
}

if (
	process.env.NODE_ENV === "production" &&
	authConfig.providers.length === 0
) {
	throw new Error(
		"Configure at least one OAuth provider: set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and/or GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.",
	);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
	...authConfig,
	adapter: PrismaAdapter(prisma),
	secret: resolvedSecret,
});

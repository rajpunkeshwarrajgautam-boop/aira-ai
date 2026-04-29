import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import {
	githubClientId,
	githubClientSecret,
	googleClientId,
	googleClientSecret,
} from "./lib/oauth-env";

const googleEnabled = !!googleClientId() && !!googleClientSecret();
const githubEnabled = !!githubClientId() && !!githubClientSecret();

/**
 * Edge-safe auth configuration (no Prisma). Used by middleware JWT validation.
 * Database-backed OAuth accounts are wired in `auth.ts` via PrismaAdapter.
 */
export const authConfig = {
	providers: [
		...(googleEnabled
			? [
					Google({
						clientId: googleClientId()!,
						clientSecret: googleClientSecret()!,
						allowDangerousEmailAccountLinking: false,
					}),
				]
			: []),
		...(githubEnabled
			? [
					GitHub({
						clientId: githubClientId()!,
						clientSecret: githubClientSecret()!,
						allowDangerousEmailAccountLinking: false,
					}),
				]
			: []),
	],
	session: {
		strategy: "jwt",
		maxAge: 30 * 24 * 60 * 60,
		updateAge: 24 * 60 * 60,
	},
	pages: {
		signIn: "/signin",
		error: "/signin",
	},
	trustHost: true,
	callbacks: {
		jwt({ token, user }) {
			if (user?.id) {
				token.sub = user.id;
			}
			return token;
		},
		session({ session, token }) {
			if (session.user && token.sub) {
				session.user.id = token.sub;
			}
			return session;
		},
	},
} satisfies NextAuthConfig;

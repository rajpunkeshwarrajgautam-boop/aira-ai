import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import {
	githubClientId,
	githubClientSecret,
	googleClientId,
	googleClientSecret,
} from "./lib/oauth-env";

const resolvedGoogleClientId = googleClientId();
const resolvedGoogleClientSecret = googleClientSecret();
const resolvedGitHubClientId = githubClientId();
const resolvedGitHubClientSecret = githubClientSecret();

const googleEnabled = !!resolvedGoogleClientId && !!resolvedGoogleClientSecret;
const githubEnabled = !!resolvedGitHubClientId && !!resolvedGitHubClientSecret;

/**
 * Edge-safe auth configuration (no Prisma). Used by middleware JWT validation.
 * Database-backed OAuth accounts are wired in `auth.ts` via PrismaAdapter.
 */
export const authConfig = {
	providers: [
		...(googleEnabled
			? [
					Google({
						clientId: resolvedGoogleClientId!,
						clientSecret: resolvedGoogleClientSecret!,
						allowDangerousEmailAccountLinking: false,
					}),
				]
			: []),
		...(githubEnabled
			? [
					GitHub({
						clientId: resolvedGitHubClientId!,
						clientSecret: resolvedGitHubClientSecret!,
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

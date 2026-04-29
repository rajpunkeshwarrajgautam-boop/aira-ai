import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

const googleEnabled =
	!!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const githubEnabled =
	!!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET;

/**
 * Edge-safe auth configuration (no Prisma). Used by middleware JWT validation.
 * Database-backed OAuth accounts are wired in `auth.ts` via PrismaAdapter.
 */
export const authConfig = {
	providers: [
		...(googleEnabled
			? [
					Google({
						clientId: process.env.GOOGLE_CLIENT_ID!,
						clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
						allowDangerousEmailAccountLinking: false,
					}),
				]
			: []),
		...(githubEnabled
			? [
					GitHub({
						clientId: process.env.GITHUB_CLIENT_ID!,
						clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { authConfig } from "./auth.config";
import {
	githubClientId,
	githubClientSecret,
	googleClientId,
	googleClientSecret,
} from "./lib/oauth-env";
import { prisma } from "./lib/prisma";

const resolvedSecret =
	process.env.NEXTAUTH_SECRET ??
	process.env.AUTH_SECRET ??
	(process.env.NODE_ENV !== "production"
		? "development-only-secret-do-not-use-in-production-min-32-chars"
		: undefined);

const isBuildTime = process.env.npm_lifecycle_event === "build";

if (process.env.NODE_ENV === "production" && !isBuildTime) {
	const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			"NEXTAUTH_SECRET (or AUTH_SECRET) must be set to a strong value (at least 32 characters) in production.",
		);
	}
}

if (
	process.env.NODE_ENV === "production" &&
	!isBuildTime &&
	authConfig.providers.length === 0
) {
	throw new Error(
		"Configure at least one OAuth provider: set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and/or GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.",
	);
}

const authDiagnostics = {
	googleClientIdExists: !!googleClientId(),
	googleClientIdLength: googleClientId()?.length ?? 0,
	googleClientSecretExists: !!googleClientSecret(),
	googleClientSecretLength: googleClientSecret()?.length ?? 0,
	githubClientIdExists: !!githubClientId(),
	githubClientIdLength: githubClientId()?.length ?? 0,
	githubClientSecretExists: !!githubClientSecret(),
	githubClientSecretLength: githubClientSecret()?.length ?? 0,
	providerCount: authConfig.providers.length,
	databaseUrlExists: !!process.env.DATABASE_URL,
	authSecretExists: !!process.env.AUTH_SECRET || !!process.env.NEXTAUTH_SECRET,
	authUrlExists: !!process.env.AUTH_URL,
	nextauthUrlExists: !!process.env.NEXTAUTH_URL,
};

if (process.env.NODE_ENV !== "production" || process.env.AUTH_DEBUG === "true") {
	console.info("[auth:diagnostics]", authDiagnostics);
}

const SAFE_AUTH_ERROR_KEYS = [
	"name",
	"type",
	"kind",
	"code",
	"message",
	"status",
	"error",
	"err",
	"cause",
] as const;

function safeAuthErrorDetails(details: unknown, depth = 0): unknown {
	if (details == null) return details;
	if (depth > 3) return "[TRUNCATED]";
	if (typeof details === "string" || typeof details === "number" || typeof details === "boolean") {
		return details;
	}
	if (details instanceof Error) {
		const extended = details as Error & Record<string, unknown>;
		const result: Record<string, unknown> = {
			name: details.name,
			message: details.message,
		};
		for (const key of SAFE_AUTH_ERROR_KEYS) {
			if (key === "name" || key === "message") continue;
			if (extended[key] !== undefined) {
				result[key] = safeAuthErrorDetails(extended[key], depth + 1);
			}
		}
		return result;
	}
	if (typeof details !== "object") return String(details);

	const record = details as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of SAFE_AUTH_ERROR_KEYS) {
		if (record[key] !== undefined) {
			result[key] = safeAuthErrorDetails(record[key], depth + 1);
		}
	}
	return result;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
	...authConfig,
	adapter: PrismaAdapter(prisma),
	secret: resolvedSecret,
	debug: process.env.NODE_ENV !== "production" && process.env.AUTH_DEBUG === "true",
	logger: {
		error(error) {
			console.error("[auth:error]", safeAuthErrorDetails(error));
		},
		warn(code) {
			console.warn("[auth:warn]", code);
		},
		debug(code) {
			console.info("[auth:debug]", code);
		},
	},
});

/**
 * OAuth credentials support both classic NextAuth-style names and AUTH_* aliases.
 */
export function googleClientId(): string | undefined {
	const v =
		process.env.GOOGLE_CLIENT_ID ??
		process.env.AUTH_GOOGLE_ID ??
		"";
	const normalized = v.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function googleClientSecret(): string | undefined {
	const v =
		process.env.GOOGLE_CLIENT_SECRET ??
		process.env.AUTH_GOOGLE_SECRET ??
		"";
	const normalized = v.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function githubClientId(): string | undefined {
	const v =
		process.env.GITHUB_CLIENT_ID ??
		process.env.AUTH_GITHUB_ID ??
		"";
	const normalized = v.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function githubClientSecret(): string | undefined {
	const v =
		process.env.GITHUB_CLIENT_SECRET ??
		process.env.AUTH_GITHUB_SECRET ??
		"";
	const normalized = v.trim();
	return normalized.length > 0 ? normalized : undefined;
}

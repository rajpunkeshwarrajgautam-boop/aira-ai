type AuthEnvironment = Record<string, string | undefined>;

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function configuredOrigin(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
		return url.origin;
	} catch {
		return null;
	}
}

function vercelOrigin(host: string | undefined): string | null {
	if (!host || host.includes("/") || host.includes("\\")) return null;
	try {
		const url = new URL(`https://${host}`);
		if (url.hostname !== host && url.host !== host) return null;
		return url.origin;
	} catch {
		return null;
	}
}

export function isVercelPreviewEnvironment(env: AuthEnvironment = process.env): boolean {
	return env.VERCEL_ENV === "preview";
}

/**
 * Auth.js v5 rewrites request origins to AUTH_URL/NEXTAUTH_URL when either is
 * defined. A production-scoped value inherited by a Vercel Preview therefore
 * turns a Preview OAuth flow into a production OAuth flow. On Preview only,
 * remove that fixed origin from the current process so Auth.js can use the
 * platform-authenticated request host. Production and local configuration are
 * intentionally untouched.
 */
export function suppressFixedAuthUrlOnPreview(env: AuthEnvironment = process.env): boolean {
	if (!isVercelPreviewEnvironment(env)) return false;
	delete env.AUTH_URL;
	delete env.NEXTAUTH_URL;
	return true;
}

export function runtimeTrustedAuthOrigins(env: AuthEnvironment = process.env): readonly string[] {
	const origins = new Set<string>();
	const add = (origin: string | null) => {
		if (origin) origins.add(origin);
	};

	if (isVercelPreviewEnvironment(env)) {
		// These are Vercel system values for this project/deployment. Do not use a
		// wildcard *.vercel.app trust rule: only the exact runtime-generated hosts
		// are accepted.
		add(vercelOrigin(env.VERCEL_URL));
		add(vercelOrigin(env.VERCEL_BRANCH_URL));
		return [...origins];
	}

	add(configuredOrigin(env.AUTH_URL));
	add(configuredOrigin(env.NEXTAUTH_URL));

	if (env.VERCEL_ENV === "production") {
		add(vercelOrigin(env.VERCEL_PROJECT_PRODUCTION_URL));
		add(vercelOrigin(env.VERCEL_URL));
	}

	return [...origins];
}

function isLocalDevelopmentUrl(url: URL, env: AuthEnvironment): boolean {
	if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
		return false;
	}
	return (
		(url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
		HTTP_PROTOCOLS.has(url.protocol)
	);
}

export function isTrustedAuthRequestUrl(
	requestUrl: string,
	env: AuthEnvironment = process.env,
): boolean {
	let url: URL;
	try {
		url = new URL(requestUrl);
	} catch {
		return false;
	}
	if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) return false;
	if (runtimeTrustedAuthOrigins(env).includes(url.origin)) return true;
	return isLocalDevelopmentUrl(url, env);
}

/**
 * Normalize forwarding headers from the already-validated request URL. This
 * prevents client-supplied Host/X-Forwarded-Host/X-Forwarded-Proto values from
 * controlling Auth.js callback construction.
 */
export function trustedAuthRequestHeaders(
	requestUrl: string,
	incomingHeaders: Headers,
	env: AuthEnvironment = process.env,
): Headers | null {
	if (!isTrustedAuthRequestUrl(requestUrl, env)) return null;
	const url = new URL(requestUrl);
	const headers = new Headers(incomingHeaders);
	headers.set("host", url.host);
	headers.set("x-forwarded-host", url.host);
	headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
	return headers;
}

/** Same-origin redirect policy used by the server-side Auth.js redirect callback. */
export function safeAuthRedirect(url: string, baseUrl: string): string {
	let base: URL;
	try {
		base = new URL(baseUrl);
	} catch {
		return baseUrl;
	}

	if (!HTTP_PROTOCOLS.has(base.protocol) || base.username || base.password) return baseUrl;

	try {
		const candidate = new URL(url, base);
		if (
			candidate.origin !== base.origin ||
			candidate.protocol !== base.protocol ||
			candidate.username ||
			candidate.password
		) {
			return base.origin;
		}
		return candidate.toString();
	} catch {
		return base.origin;
	}
}

/**
 * Client-facing callback values are reduced to a relative path before being
 * submitted to Auth.js. Absolute same-origin values are accepted only when the
 * caller supplies the current origin; every external/scheme-relative value
 * falls back to '/'. Auth.js repeats the same-origin check server-side.
 */
export function safeAuthReturnPath(
	value: string | null | undefined,
	currentOrigin?: string,
): string {
	if (!value) return "/";
	let base: URL;
	try {
		base = new URL(currentOrigin ?? "https://aira.invalid");
	} catch {
		return "/";
	}

	try {
		const candidate = new URL(value, base);
		if (candidate.origin !== base.origin || !HTTP_PROTOCOLS.has(candidate.protocol)) return "/";
		return `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
	} catch {
		return "/";
	}
}

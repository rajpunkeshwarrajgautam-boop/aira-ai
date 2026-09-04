
export interface IntegrityCheckResult {
	valid: boolean;
	response?: Response;
}

function getTrustedOrigins(req: Request): Set<string> {
	const trusted = new Set<string>();

	// 1. Server request URL origin (canonical origin of the incoming request URL as parsed by server)
	try {
		const reqUrl = new URL(req.url);
		if (reqUrl.origin && reqUrl.origin !== "null") {
			trusted.add(reqUrl.origin.toLowerCase());
		}
	} catch {
		// Ignore invalid req.url
	}

	// 2. Explicitly configured server environment origins
	const envUrls = [
		process.env.NEXTAUTH_URL,
		process.env.AUTH_URL,
		process.env.VERCEL_PROJECT_PRODUCTION_URL
			? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
			: undefined,
		process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
	];

	for (const envUrl of envUrls) {
		if (!envUrl) continue;
		try {
			const parsed = new URL(envUrl.startsWith("http") ? envUrl : `https://${envUrl}`);
			if (parsed.origin && parsed.origin !== "null") {
				trusted.add(parsed.origin.toLowerCase());
			}
		} catch {
			// Ignore invalid env URL
		}
	}

	// 3. Local development & test environment defaults
	const isDevOrTest = process.env.NODE_ENV !== "production" || !process.env.NODE_ENV;

	if (isDevOrTest) {
		trusted.add("http://localhost:3000");
		trusted.add("http://127.0.0.1:3000");
		trusted.add("http://localhost:3001");
		trusted.add("http://127.0.0.1:3001");
	}

	return trusted;
}

/**
 * Validates Content-Type header for mutation requests.
 * Accepts `application/json` (case-insensitive, permitting charset/parameters).
 * Rejects missing content-type, text/plain, form data, etc. with HTTP 415 UNSUPPORTED_MEDIA_TYPE.
 */
export function validateContentType(req: Request): IntegrityCheckResult {
	const contentTypeHeader = req.headers.get("content-type");
	if (!contentTypeHeader) {
		return {
			valid: false,
			response: Response.json(
				{
					error: {
						code: "UNSUPPORTED_MEDIA_TYPE",
						message: "Content-Type header is required and must be application/json.",
					},
				},
				{ status: 415 },
			),
		};
	}

	// Parse media type before semicolon (e.g. "application/json; charset=utf-8" -> "application/json")
	const mediaType = contentTypeHeader.split(";")[0]?.trim().toLowerCase();
	if (mediaType !== "application/json") {
		return {
			valid: false,
			response: Response.json(
				{
					error: {
						code: "UNSUPPORTED_MEDIA_TYPE",
						message: "Unsupported Content-Type. Only application/json is accepted.",
					},
				},
				{ status: 415 },
			),
		};
	}

	return { valid: true };
}

/**
 * Validates Origin and Referer for state-changing mutation requests (POST, PATCH, DELETE).
 * Enforces same-origin policy against server-trusted origins.
 * Rejects foreign, null, malformed, or missing origins with HTTP 403 CSRF_REJECTED / FORBIDDEN.
 */
export function validateMutationRequestIntegrity(req: Request): IntegrityCheckResult {
	// 1. Content-Type check first -> 415 if invalid
	const contentTypeResult = validateContentType(req);
	if (!contentTypeResult.valid) {
		return contentTypeResult;
	}

	const originHeader = req.headers.get("origin");
	const refererHeader = req.headers.get("referer");

	let candidateOrigin: string | null = null;

	if (originHeader !== null) {
		const rawOrigin = originHeader.trim();
		if (rawOrigin === "null" || rawOrigin === "") {
			return {
				valid: false,
				response: Response.json(
					{
						error: {
							code: "CSRF_REJECTED",
							message: "Opaque or null Origin header is forbidden.",
						},
					},
					{ status: 403 },
				),
			};
		}

		try {
			const parsed = new URL(rawOrigin);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return {
					valid: false,
					response: Response.json(
						{
							error: {
								code: "CSRF_REJECTED",
								message: "Forbidden origin protocol.",
							},
						},
						{ status: 403 },
					),
				};
			}
			if (parsed.username || parsed.password) {
				return {
					valid: false,
					response: Response.json(
						{
							error: {
								code: "CSRF_REJECTED",
								message: "User-info in Origin header is forbidden.",
							},
						},
						{ status: 403 },
					),
				};
			}
			candidateOrigin = parsed.origin.toLowerCase();
		} catch {
			return {
				valid: false,
				response: Response.json(
					{
						error: {
							code: "CSRF_REJECTED",
							message: "Malformed Origin header.",
						},
					},
					{ status: 403 },
				),
			};
		}
	} else if (refererHeader !== null) {
		const rawReferer = refererHeader.trim();
		if (rawReferer === "") {
			return {
				valid: false,
				response: Response.json(
					{
						error: {
							code: "CSRF_REJECTED",
							message: "Empty Referer header.",
						},
					},
					{ status: 403 },
				),
			};
		}

		try {
			const parsed = new URL(rawReferer);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return {
					valid: false,
					response: Response.json(
						{
							error: {
								code: "CSRF_REJECTED",
								message: "Forbidden Referer protocol.",
							},
						},
						{ status: 403 },
					),
				};
			}
			if (parsed.username || parsed.password) {
				return {
					valid: false,
					response: Response.json(
						{
							error: {
								code: "CSRF_REJECTED",
								message: "User-info in Referer header is forbidden.",
							},
						},
						{ status: 403 },
					),
				};
			}
			candidateOrigin = parsed.origin.toLowerCase();
		} catch {
			return {
				valid: false,
				response: Response.json(
					{
						error: {
							code: "CSRF_REJECTED",
							message: "Malformed Referer header.",
						},
					},
					{ status: 403 },
				),
			};
		}
	} else {
		// Missing both Origin and Referer on state-changing browser mutation routes
		return {
			valid: false,
			response: Response.json(
				{
					error: {
						code: "CSRF_REJECTED",
						message: "State-changing mutation requests require a valid Origin or Referer header.",
					},
				},
				{ status: 403 },
			),
		};
	}

	const trustedOrigins = getTrustedOrigins(req);
	if (!candidateOrigin || !trustedOrigins.has(candidateOrigin)) {
		return {
			valid: false,
			response: Response.json(
				{
					error: {
						code: "CSRF_REJECTED",
						message: "Forbidden cross-origin request.",
					},
				},
				{ status: 403 },
			),
		};
	}

	return { valid: true };
}


/* eslint-disable turbo/no-undeclared-env-vars */

export interface IntegrityCheckResult {
	valid: boolean;
	response?: Response;
}

/**
 * Returns the set of server-configured trusted origins.
 * Independent of incoming request data (req.url, Host headers, X-Forwarded-*).
 */
export function getConfiguredTrustedOrigins(): { origins: Set<string>; isConfigured: boolean } {
	const trusted = new Set<string>();

	// 1. Explicitly configured server environment origins
	const envUrls = [
		process.env.AUTH_URL,
		process.env.NEXTAUTH_URL,
		process.env.VERCEL_PROJECT_PRODUCTION_URL
			? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//i, "")}`
			: undefined,
		process.env.VERCEL_URL
			? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//i, "")}`
			: undefined,
	];

	for (const envUrl of envUrls) {
		if (!envUrl) continue;
		try {
			const parsed = new URL(
				envUrl.startsWith("http://") || envUrl.startsWith("https://") ? envUrl : `https://${envUrl}`,
			);
			if (
				(parsed.protocol === "http:" || parsed.protocol === "https:") &&
				!parsed.username &&
				!parsed.password &&
				parsed.origin &&
				parsed.origin !== "null" &&
				!parsed.origin.includes("*")
			) {
				trusted.add(parsed.origin.toLowerCase());
			}
		} catch {
			// Ignore invalid env URL
		}
	}

	// 2. Local development & test environment defaults (ONLY in non-production)
	const isDevOrTest = process.env.NODE_ENV !== "production" || !process.env.NODE_ENV;

	if (isDevOrTest) {
		trusted.add("http://localhost");
		trusted.add("http://127.0.0.1");
		trusted.add("http://localhost:3000");
		trusted.add("http://127.0.0.1:3000");
		trusted.add("http://localhost:3001");
		trusted.add("http://127.0.0.1:3001");
	}

	return {
		origins: trusted,
		isConfigured: trusted.size > 0,
	};
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
 * Enforces same-origin policy against server-trusted origins set.
 * Rejects untrusted request target URLs or untrusted request source origins with HTTP 403 CSRF_REJECTED.
 */
export function validateMutationRequestIntegrity(req: Request): IntegrityCheckResult {
	// 1. Content-Type check -> 415 if invalid
	const contentTypeResult = validateContentType(req);
	if (!contentTypeResult.valid) {
		return contentTypeResult;
	}

	// 2. Fetch server-configured trusted origins
	const { origins: trustedOrigins, isConfigured } = getConfiguredTrustedOrigins();

	// Fail closed if production server has zero trusted configuration
	if (!isConfigured) {
		return {
			valid: false,
			response: Response.json(
				{
					error: {
						code: "SERVER_CONFIGURATION_ERROR",
						message: "Server is missing trusted origin configuration.",
					},
				},
				{ status: 500 },
			),
		};
	}

	// 3. Validate request target URL origin (req.url is checked against trustedOrigins, never added to it!)
	let requestTargetOrigin: string;
	try {
		const parsedReqUrl = new URL(req.url);
		if (parsedReqUrl.protocol !== "http:" && parsedReqUrl.protocol !== "https:") {
			return {
				valid: false,
				response: Response.json(
					{ error: { code: "CSRF_REJECTED", message: "Forbidden request target protocol." } },
					{ status: 403 },
				),
			};
		}
		requestTargetOrigin = parsedReqUrl.origin.toLowerCase();
	} catch {
		return {
			valid: false,
			response: Response.json(
				{ error: { code: "CSRF_REJECTED", message: "Malformed request target URL." } },
				{ status: 403 },
			),
		};
	}

	if (!trustedOrigins.has(requestTargetOrigin)) {
		return {
			valid: false,
			response: Response.json(
				{ error: { code: "CSRF_REJECTED", message: "Untrusted request target origin." } },
				{ status: 403 },
			),
		};
	}

	// 4. Validate source origin (Origin header or Referer fallback)
	const originHeader = req.headers.get("origin");
	const refererHeader = req.headers.get("referer");

	let candidateOrigin: string | null = null;

	if (originHeader !== null) {
		const rawOrigin = originHeader.trim();
		if (rawOrigin === "null" || rawOrigin === "") {
			return {
				valid: false,
				response: Response.json(
					{ error: { code: "CSRF_REJECTED", message: "Opaque or null Origin header is forbidden." } },
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
						{ error: { code: "CSRF_REJECTED", message: "Forbidden origin protocol." } },
						{ status: 403 },
					),
				};
			}
			if (parsed.username || parsed.password) {
				return {
					valid: false,
					response: Response.json(
						{ error: { code: "CSRF_REJECTED", message: "User-info in Origin header is forbidden." } },
						{ status: 403 },
					),
				};
			}
			candidateOrigin = parsed.origin.toLowerCase();
		} catch {
			return {
				valid: false,
				response: Response.json(
					{ error: { code: "CSRF_REJECTED", message: "Malformed Origin header." } },
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
					{ error: { code: "CSRF_REJECTED", message: "Empty Referer header." } },
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
						{ error: { code: "CSRF_REJECTED", message: "Forbidden Referer protocol." } },
						{ status: 403 },
					),
				};
			}
			if (parsed.username || parsed.password) {
				return {
					valid: false,
					response: Response.json(
						{ error: { code: "CSRF_REJECTED", message: "User-info in Referer header is forbidden." } },
						{ status: 403 },
					),
				};
			}
			candidateOrigin = parsed.origin.toLowerCase();
		} catch {
			return {
				valid: false,
				response: Response.json(
					{ error: { code: "CSRF_REJECTED", message: "Malformed Referer header." } },
					{ status: 403 },
				),
			};
		}
	} else {
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

	if (!candidateOrigin || !trustedOrigins.has(candidateOrigin)) {
		return {
			valid: false,
			response: Response.json(
				{ error: { code: "CSRF_REJECTED", message: "Forbidden cross-origin request." } },
				{ status: 403 },
			),
		};
	}

	return { valid: true };
}

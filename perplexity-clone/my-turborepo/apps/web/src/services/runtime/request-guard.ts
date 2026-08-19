const MAX_QUERY_LENGTH = 16_000;

/** C0 controls except tab/newline/carriage return, plus DEL. */
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export class RequestGuardError extends Error {
	readonly code: "EMPTY_QUERY" | "QUERY_TOO_LONG" | "DISALLOWED_CONTROL_CHARACTER";
	readonly status = 400;

	constructor(
		code: RequestGuardError["code"],
		message: string,
	) {
		super(message);
		this.name = "RequestGuardError";
		this.code = code;
	}
}

/**
 * Conservative ingress normalization for user-authored text.
 *
 * We deliberately do NOT strip HTML, code, prompt-like text, zero-width characters,
 * or instruction words because those can be legitimate user content. The guard only
 * canonicalizes line endings / Unicode composition and rejects non-text control bytes
 * that are useful for parser smuggling but not normal chat input.
 */
export function normalizeAndGuardUserQuery(raw: string): string {
	const normalized = raw
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.normalize("NFC")
		.trim();

	if (!normalized) {
		throw new RequestGuardError("EMPTY_QUERY", "query must not be empty");
	}
	if (normalized.length > MAX_QUERY_LENGTH) {
		throw new RequestGuardError("QUERY_TOO_LONG", "query exceeds maximum length");
	}
	if (DISALLOWED_CONTROL.test(normalized)) {
		throw new RequestGuardError(
			"DISALLOWED_CONTROL_CHARACTER",
			"query contains unsupported control characters",
		);
	}

	return normalized;
}

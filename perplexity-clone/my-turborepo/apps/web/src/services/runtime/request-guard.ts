const MAX_QUERY_LENGTH = 16_000;

function containsDisallowedControl(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		// C0 controls except tab/newline/carriage return, plus DEL.
		if (
			(code >= 0x00 && code <= 0x08) ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f) ||
			code === 0x7f
		) {
			return true;
		}
	}
	return false;
}

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
	if (containsDisallowedControl(normalized)) {
		throw new RequestGuardError(
			"DISALLOWED_CONTROL_CHARACTER",
			"query contains unsupported control characters",
		);
	}

	return normalized;
}

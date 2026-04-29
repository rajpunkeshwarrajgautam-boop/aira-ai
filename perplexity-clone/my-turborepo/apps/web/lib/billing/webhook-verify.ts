import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

function decodeBase64Signature(signature: string): Buffer {
	const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
	const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	return Buffer.from(normalized + pad, "base64");
}

/**
 * Verifies Cashfree PG webhook signature per documented flow:
 * Base64(HMAC-SHA256(webhookSecret, timestamp + rawBody))
 */
export function verifyCashfreeWebhookSignature(
	rawBody: string,
	headers: Headers,
	webhookSecret: string,
): boolean {
	const signature = headers.get("x-webhook-signature");
	const timestamp = headers.get("x-webhook-timestamp");
	if (!signature || !timestamp) {
		return false;
	}

	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > WEBHOOK_MAX_SKEW_MS) {
		return false;
	}

	const expectedB64 = createHmac("sha256", webhookSecret)
		.update(timestamp + rawBody)
		.digest("base64");

	try {
		const a = decodeBase64Signature(expectedB64.trim());
		const b = decodeBase64Signature(signature.trim());
		if (a.length !== b.length) {
			return false;
		}
		return timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

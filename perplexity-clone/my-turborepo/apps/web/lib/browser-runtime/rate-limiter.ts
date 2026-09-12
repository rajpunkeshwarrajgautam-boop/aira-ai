export type BrowserRateLimitType = "session_create" | "action" | "screenshot";

interface RateLimitBucket {
	count: number;
	resetAt: number;
}

const LIMITS: Record<BrowserRateLimitType, { max: number; windowMs: number }> = {
	session_create: { max: 5, windowMs: 60_000 },
	action: { max: 30, windowMs: 60_000 },
	screenshot: { max: 30, windowMs: 60_000 },
};

export const MAX_ACTIVE_SESSIONS_PER_USER = 3;

const buckets = new Map<string, RateLimitBucket>();

export function checkBrowserRateLimit(
	userId: string,
	type: BrowserRateLimitType,
): { allowed: boolean; retryAfter?: number } {
	const key = `${userId}:${type}`;
	const now = Date.now();
	const config = LIMITS[type];
	let bucket = buckets.get(key);

	if (!bucket || bucket.resetAt <= now) {
		bucket = { count: 1, resetAt: now + config.windowMs };
		buckets.set(key, bucket);
		return { allowed: true };
	}

	if (bucket.count >= config.max) {
		const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
		return { allowed: false, retryAfter };
	}

	bucket.count += 1;
	return { allowed: true };
}

export function resetBrowserRateLimitsForTesting(): void {
	buckets.clear();
}

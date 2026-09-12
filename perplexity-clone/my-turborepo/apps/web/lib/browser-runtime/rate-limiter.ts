import { prisma } from "@/lib/prisma";

export type BrowserRateLimitType = "session_create" | "action" | "screenshot";

export interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
	error?: "BROWSER_RATE_LIMIT_UNAVAILABLE";
}

interface RateLimitConfig {
	max: number;
	windowSeconds: number;
}

const LIMITS: Record<BrowserRateLimitType, RateLimitConfig> = {
	session_create: { max: 5, windowSeconds: 60 },
	action: { max: 30, windowSeconds: 60 },
	screenshot: { max: 30, windowSeconds: 60 },
};

export const MAX_ACTIVE_SESSIONS_PER_USER = 3;

// In-memory fallback buckets strictly for isolated test suites
interface RateLimitBucket {
	count: number;
	resetAt: number;
}
const inMemoryBuckets = new Map<string, RateLimitBucket>();

/**
 * Server-authoritative distributed rate limiter backed by PostgreSQL.
 * Uses pg_advisory_xact_lock to ensure atomic serializable rate limiting
 * across concurrent Vercel serverless functions without overselling limits.
 * Fails closed in Preview/Production with BROWSER_RATE_LIMIT_UNAVAILABLE if DB is down.
 */
export async function checkBrowserRateLimit(
	userId: string,
	type: BrowserRateLimitType,
): Promise<RateLimitResult> {
	const config = LIMITS[type];
	const now = Date.now();
	const windowMs = config.windowSeconds * 1000;
	const lockKey = `browser_rate_limit:${userId}:${type}`;

	try {
		const windowStart = new Date(now - windowMs);
		const cleanupThreshold = new Date(now - 300_000); // 5 minutes retention
		const eventId = crypto.randomUUID();

		const result = await prisma.$transaction(async (tx) => {
			// 1. Obtain transaction-scoped advisory lock for the (userId + type) hash
			await tx.$executeRaw`
				SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
			`;

			// 2. Prune expired entries to maintain bounded table size
			await tx.$executeRaw`
				DELETE FROM "BrowserRateLimitEvent"
				WHERE "createdAt" < ${cleanupThreshold}
			`;

			// 3. Count events in active sliding window under the advisory lock
			const rows = await tx.$queryRaw<Array<{ count: bigint | number; oldest: Date | null }>>`
				SELECT count(*)::int as count, min("createdAt") as oldest
				FROM "BrowserRateLimitEvent"
				WHERE "userId" = ${userId}
				  AND "type" = ${type}
				  AND "createdAt" >= ${windowStart}
			`;

			const currentCount = Number(rows[0]?.count ?? 0);
			if (currentCount >= config.max) {
				const oldestTime = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : now - windowMs;
				const retryAfter = Math.max(1, Math.ceil((oldestTime + windowMs - now) / 1000));
				return { allowed: false, retryAfter };
			}

			// 4. Atomically record this request event within the locked transaction
			await tx.$executeRaw`
				INSERT INTO "BrowserRateLimitEvent" ("id", "userId", "type", "createdAt")
				VALUES (${eventId}, ${userId}, ${type}, current_timestamp)
			`;

			return { allowed: true };
		});

		return result;
	} catch (error) {
		// In Preview and Production: FAIL CLOSED
		// In-memory fallback is strictly restricted to explicit local test or development environments
		// and is NEVER allowed in Preview (Vercel) or Production.
		const isExplicitDevOrTest =
			(process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
			!process.env.VERCEL &&
			process.env.VERCEL_ENV !== "preview";

		if (isExplicitDevOrTest) {
			return checkBrowserRateLimitMemory(userId, type);
		}

		console.error("Distributed browser rate limiter error:", error);
		return {
			allowed: false,
			error: "BROWSER_RATE_LIMIT_UNAVAILABLE",
			retryAfter: 5,
		};
	}
}

/**
 * Synchronous in-memory rate limit checker for isolated unit tests.
 */
export function checkBrowserRateLimitMemory(
	userId: string,
	type: BrowserRateLimitType,
): RateLimitResult {
	const key = `${userId}:${type}`;
	const now = Date.now();
	const config = LIMITS[type];
	const windowMs = config.windowSeconds * 1000;
	let bucket = inMemoryBuckets.get(key);

	if (!bucket || bucket.resetAt <= now) {
		bucket = { count: 1, resetAt: now + windowMs };
		inMemoryBuckets.set(key, bucket);
		return { allowed: true };
	}

	if (bucket.count >= config.max) {
		const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
		return { allowed: false, retryAfter };
	}

	bucket.count += 1;
	return { allowed: true };
}

export async function resetBrowserRateLimitsForTesting(): Promise<void> {
	inMemoryBuckets.clear();
	try {
		await prisma.$executeRawUnsafe(`DELETE FROM "BrowserRateLimitEvent"`);
	} catch {
		// Ignore in environments without DB
	}
}

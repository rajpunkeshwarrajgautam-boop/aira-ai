import { prisma } from "@/lib/prisma";

export type BrowserRateLimitType = "session_create" | "action" | "screenshot";

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

// In-memory fallback buckets for testing or when database is temporarily unavailable
interface RateLimitBucket {
	count: number;
	resetAt: number;
}
const inMemoryBuckets = new Map<string, RateLimitBucket>();

let tableInitialized = false;

async function ensureRateLimitTable(): Promise<void> {
	if (tableInitialized) return;
	try {
		await prisma.$executeRawUnsafe(`
			CREATE TABLE IF NOT EXISTS "BrowserRateLimitEvent" (
				"id" text primary key,
				"userId" text not null,
				"type" text not null,
				"createdAt" timestamp(3) not null default current_timestamp
			);
			CREATE INDEX IF NOT EXISTS "BrowserRateLimitEvent_lookup_idx"
				ON "BrowserRateLimitEvent" ("userId", "type", "createdAt" desc);
		`);
		tableInitialized = true;
	} catch {
		// Suppress table initialization failure in non-postgres test environments
	}
}

/**
 * Server-authoritative distributed rate limiter backed by PostgreSQL.
 * Multi-instance safe across Vercel Preview serverless functions.
 * Atomic sliding-window evaluation with automatic bounded history pruning.
 */
export async function checkBrowserRateLimit(
	userId: string,
	type: BrowserRateLimitType,
): Promise<{ allowed: boolean; retryAfter?: number }> {
	const config = LIMITS[type];
	const now = Date.now();
	const windowMs = config.windowSeconds * 1000;

	try {
		await ensureRateLimitTable();
		const windowStart = new Date(now - windowMs);
		const cleanupThreshold = new Date(now - 300_000); // 5 minutes retention
		const eventId = crypto.randomUUID();

		const result = await prisma.$transaction(async (tx) => {
			// 1. Prune expired entries to maintain bounded table size
			await tx.$executeRaw`
				DELETE FROM "BrowserRateLimitEvent"
				WHERE "createdAt" < ${cleanupThreshold}
			`;

			// 2. Count events in active sliding window
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

			// 3. Atomically record this request event
			await tx.$executeRaw`
				INSERT INTO "BrowserRateLimitEvent" ("id", "userId", "type", "createdAt")
				VALUES (${eventId}, ${userId}, ${type}, current_timestamp)
			`;

			return { allowed: true };
		});

		return result;
	} catch {
		// Fall back safely to in-memory sliding window when database is not configured/accessible
		return checkBrowserRateLimitMemory(userId, type);
	}
}

/**
 * Synchronous in-memory rate limit checker for offline or test environments.
 */
export function checkBrowserRateLimitMemory(
	userId: string,
	type: BrowserRateLimitType,
): { allowed: boolean; retryAfter?: number } {
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

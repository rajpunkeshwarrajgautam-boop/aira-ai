import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

function startOfUtcDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export class AnonymousQuotaError extends Error {
	readonly status = 429;
	readonly code = "ANONYMOUS_QUOTA_EXCEEDED";

	constructor() {
		super("Sign in to continue researching.");
		this.name = "AnonymousQuotaError";
	}
}

/**
 * Atomically reserves one daily anonymous provider-spend unit before outbound
 * search/model execution. Failed provider attempts intentionally remain charged:
 * this is an economic-abuse control, not an analytics counter.
 */
export async function assertAnonymousSearchAllowed(anonymousId: string): Promise<void> {
	const owner = anonymousId.trim();
	if (!owner) throw new AnonymousQuotaError();
	const raw = process.env.ANONYMOUS_DAILY_SEARCH_LIMIT ?? "2";
	const limit = Math.max(1, Math.min(500, parseInt(raw, 10) || 2));
	const eventDay = startOfUtcDay(new Date());

	await prisma.$transaction(async (tx) => {
		// Serialize quota decisions for the same anonymous visitor. hashtextextended
		// gives a stable 64-bit advisory-lock key without persisting the identifier.
		// pg_advisory_xact_lock() returns void — use $executeRaw (not $queryRaw)
		// to avoid Prisma's "Failed to deserialize column of type 'void'" error.
		await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${owner}, 0))`;

		const [row] = await tx.$queryRaw<Array<{ count: bigint }>>`
			select count(*)::bigint as count
			from public."AnonymousSearchQuotaReservation"
			where "anonymousId" = ${owner} and "eventDay" = ${eventDay}
		`;
		if (Number(row?.count ?? 0n) >= limit) {
			throw new AnonymousQuotaError();
		}

		await tx.$executeRaw`
			insert into public."AnonymousSearchQuotaReservation" (id, "anonymousId", "eventDay")
			values (${randomUUID()}, ${owner}, ${eventDay})
		`;
	});
}

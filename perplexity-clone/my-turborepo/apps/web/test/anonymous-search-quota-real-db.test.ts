import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AnonymousQuotaError, assertAnonymousSearchAllowed } from "@/lib/anonymous-search-quota";
import { prisma } from "@/lib/prisma";

const REAL_DB = process.env.AIRA_REAL_DB_RECOVERY_TESTS === "1";

test(
	"REAL_DB: concurrent anonymous provider-spend attempts cannot exceed the daily reservation limit",
	{ skip: !REAL_DB, timeout: 60_000 },
	async (t) => {
		const anonymousId = `anon-quota-${randomUUID()}`;
		const previousLimit = process.env.ANONYMOUS_DAILY_SEARCH_LIMIT;
		process.env.ANONYMOUS_DAILY_SEARCH_LIMIT = "2";

		t.after(async () => {
			if (previousLimit === undefined) delete process.env.ANONYMOUS_DAILY_SEARCH_LIMIT;
			else process.env.ANONYMOUS_DAILY_SEARCH_LIMIT = previousLimit;
			await prisma.$executeRaw`
				delete from public."AnonymousSearchQuotaReservation"
				where "anonymousId" = ${anonymousId}
			`.catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		});

		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, () => assertAnonymousSearchAllowed(anonymousId)),
		);
		const fulfilled = attempts.filter((result) => result.status === "fulfilled");
		const rejected = attempts.filter((result) => result.status === "rejected");

		assert.equal(fulfilled.length, 2, "exactly the configured number of concurrent attempts must reserve quota");
		assert.equal(rejected.length, 6);
		for (const result of rejected) {
			assert.ok(result.status === "rejected" && result.reason instanceof AnonymousQuotaError);
		}

		const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
			select count(*)::bigint as count
			from public."AnonymousSearchQuotaReservation"
			where "anonymousId" = ${anonymousId}
		`;
		assert.equal(Number(row?.count ?? 0n), 2, "failed racing requests must not create extra reservations");

		await assert.rejects(
			() => assertAnonymousSearchAllowed(anonymousId),
			(error: unknown) => error instanceof AnonymousQuotaError && error.code === "ANONYMOUS_QUOTA_EXCEEDED",
		);
	},
);

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../generated/prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
	prisma?: PrismaClient;
	pool?: Pool;
};

function createPrismaClient(): PrismaClient {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error(
			"DATABASE_URL is not set. Configure PostgreSQL and run `npx prisma migrate deploy` from the repository root.",
		);
	}

	const pool =
		globalForPrisma.pool ??
		new Pool({
			connectionString,
			max: Number(process.env.DATABASE_POOL_MAX ?? 10),
			idleTimeoutMillis: 20_000,
			connectionTimeoutMillis: 10_000,
		});

	globalForPrisma.pool = pool;

	const adapter = new PrismaPg(pool);

	return new PrismaClient({
		adapter,
		log:
			process.env.NODE_ENV === "development"
				? ["error", "warn"]
				: ["error"],
	});
}

export const prisma: PrismaClient =
	globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}

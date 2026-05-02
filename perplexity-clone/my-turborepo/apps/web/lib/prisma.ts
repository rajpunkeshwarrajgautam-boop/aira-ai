import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
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

// Lazy-load the Prisma client so that createPrismaClient() is not
// called at the top-level during Next.js build module evaluation.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
	get(target, prop) {
		if (!globalForPrisma.prisma) {
			globalForPrisma.prisma = createPrismaClient();
		}
		return Reflect.get(globalForPrisma.prisma, prop);
	},
});

if (process.env.NODE_ENV !== "production") {
	// Not storing the proxy itself, but we let the proxy initialize it
}

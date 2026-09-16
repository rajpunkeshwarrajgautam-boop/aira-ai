export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";

export async function GET(): Promise<Response> {
	let dbOk = false;

	if (process.env.DATABASE_URL) {
		try {
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("DB probe timeout after 2500ms")), 2500),
			);
			await Promise.race([prisma.$queryRaw`SELECT 1 as probe`, timeoutPromise]);
			dbOk = true;
		} catch {
			dbOk = false;
		}
	}

	const hasProvider = Boolean(
		process.env.NVIDIA_API_KEY ||
			process.env.OPENAI_API_KEY ||
			process.env.OMNIROUTE_API_KEY,
	);
	const hasAuth = Boolean(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);

	const isReady = dbOk && hasProvider && hasAuth;

	return Response.json(
		{
			status: isReady ? "ready" : "not_ready",
			checks: {
				database: dbOk ? "connected" : "degraded",
				providersConfigured: hasProvider,
				authConfigured: hasAuth,
			},
			timestamp: new Date().toISOString(),
		},
		{
			status: isReady ? 200 : 503,
			headers: {
				"Cache-Control": "no-store, no-cache, must-revalidate",
			},
		},
	);
}

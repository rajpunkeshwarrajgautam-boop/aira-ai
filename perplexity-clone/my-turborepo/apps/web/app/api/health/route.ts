export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
	return Response.json(
		{
			status: "ok",
			service: "aira-ai",
			uptime: Math.floor(process.uptime()),
			timestamp: new Date().toISOString(),
		},
		{
			status: 200,
			headers: {
				"Cache-Control": "no-store, no-cache, must-revalidate",
			},
		},
	);
}

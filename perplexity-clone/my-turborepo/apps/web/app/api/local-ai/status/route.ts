import { auth } from "@/auth";
import { getLocalAiConfig } from "@services/local-ai/config";
import { getLocalAiHealth, listLocalAiModels } from "@services/local-ai/llama-cpp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	let config;
	try {
		config = getLocalAiConfig();
	} catch (error) {
		return Response.json(
			{
				enabled: true,
				configured: false,
				health: {
					configured: false,
					reachable: false,
					status: "not-configured",
					model: null,
					latencyMs: null,
					error: error instanceof Error ? error.message : "Invalid local AI configuration.",
				},
				models: [],
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	const health = await getLocalAiHealth(config);
	let models: readonly string[] = [];
	if (health.reachable) {
		models = await listLocalAiModels(config).catch(() => []);
	}

	return Response.json(
		{
			enabled: config.enabled,
			configured: config.configured,
			localFirst: config.localFirst,
			required: config.required,
			model: config.model || null,
			health,
			models,
			capabilities: {
				chat: true,
				toolCalling: true,
				workspaceRag: true,
				leadWorker: true,
				emailWorker: true,
				hybridFallback: !config.required,
			},
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

import { getAgentRuntimeStates } from "@/lib/agent-runtime/registry";
import {
	browserRuntimeHealth,
	isBrowserRuntimeConfigured,
	isBrowserRuntimeEnabled,
} from "@/lib/browser-runtime/client";
import { getOmniRouteConfigOrDisabled } from "@services/omniroute/config";
import { fetchOmniRouteModels } from "@services/omniroute/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	if (process.env.VERCEL_ENV !== "preview") {
		return Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
	}

	const [agentStates, browserHealthy] = await Promise.all([
		getAgentRuntimeStates().catch(() => []),
		browserRuntimeHealth().catch(() => false),
	]);
	const browserEnabled = isBrowserRuntimeEnabled();
	const browserConfigured = isBrowserRuntimeConfigured();

	const omniConfig = getOmniRouteConfigOrDisabled();
	let omniConnected = false;
	let omniModelCount = 0;
	if (omniConfig.configured) {
		try {
			const snapshot = await fetchOmniRouteModels();
			omniConnected = true;
			omniModelCount = snapshot.models.length;
		} catch {
			omniConnected = false;
		}
	}

	return Response.json(
		{
			environment: process.env.VERCEL_ENV,
			gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
			agentRuntimes: agentStates.map((state) => ({
				id: state.id,
				enabled: state.enabled,
				configured: state.configured,
				healthy: state.healthy,
				ready: state.ready,
			})),
			browserRuntime: {
				enabled: browserEnabled,
				configured: browserConfigured,
				healthy: browserHealthy,
				ready: browserEnabled && browserConfigured && browserHealthy,
			},
			omniRoute: {
				enabled: omniConfig.enabled,
				configured: omniConfig.configured,
				connected: omniConnected,
				modelCount: omniModelCount,
			},
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

import { auth } from "@/auth";
import { getAgentRuntimeStates } from "@/lib/agent-runtime/registry";
import { parseRuntimePriority, selectRuntimeId } from "@/lib/agent-runtime/selection";
import type { AgentRuntimeId } from "@/lib/agent-runtime/types";
import { toolAvailability } from "@/lib/tool-gateway/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit): Response {
	const headers = new Headers(init?.headers);
	headers.set("Cache-Control", "no-store");
	return Response.json(body, { ...init, headers });
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return noStoreJson(
			{ error: { code: "UNAUTHENTICATED", message: "Sign in required." } },
			{ status: 401 },
		);
	}

	const workEnabled = process.env.AIRA_WORK_RUNTIME_ENABLED !== "false";
	const [runtimeStates, tools] = await Promise.all([
		getAgentRuntimeStates().catch(() => []),
		toolAvailability().catch(() => ({} as Record<string, boolean>)),
	]);

	let preferredProvider: AgentRuntimeId | null = null;
	let executionReady = false;
	try {
		preferredProvider = selectRuntimeId({
			states: runtimeStates,
			priority: parseRuntimePriority(process.env.AIRA_AGENT_RUNTIME_PRIORITY),
		});
		executionReady = workEnabled && runtimeStates.some((s) => s.id === preferredProvider && s.ready);
	} catch {
		executionReady = false;
	}

	const browserReady = Boolean(tools.browser);
	const knowledgeReady = Boolean(tools.files && tools.memory);
	const degradedCapabilities: string[] = [];
	if (!browserReady) degradedCapabilities.push("BROWSER_OFFLINE");
	if (!tools.web) degradedCapabilities.push("WEB_SEARCH_OFFLINE");

	const ready = workEnabled && executionReady;
	let reason: string | null = null;
	if (!workEnabled) {
		reason = "AIRA Work execution is disabled by server configuration.";
	} else if (!executionReady) {
		reason = "No autonomous agent runtime is ready for managed execution.";
	}

	return noStoreJson({
		enabled: workEnabled,
		configured: runtimeStates.some((s) => s.configured),
		ready,
		provider: preferredProvider,
		reason,
		degradedCapabilities,
		subsystems: {
			planner: { ready: true },
			agentExecution: {
				ready: executionReady,
				provider: preferredProvider,
			},
			browser: {
				ready: browserReady,
				status: browserReady ? "WORKING_E2E_IN_PREVIEW" : "INFRASTRUCTURE_BLOCKED",
			},
			knowledge: {
				ready: knowledgeReady,
				status: "WORKING_E2E_IN_PREVIEW",
			},
			route: {
				ready: true,
				status: "WORKING_E2E_IN_PREVIEW",
			},
		},
		checkedAt: new Date().toISOString(),
	});
}

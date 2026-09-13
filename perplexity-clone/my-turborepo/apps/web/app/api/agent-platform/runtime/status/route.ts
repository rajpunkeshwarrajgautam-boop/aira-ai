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
	const plannerConfigured = Boolean(
		process.env.OPENAI_API_KEY?.trim() ||
			process.env.NVIDIA_API_KEY?.trim() ||
			process.env.OMNIROUTE_API_KEY?.trim(),
	);
	const plannerReady = workEnabled && plannerConfigured;

	const routeConfigured = Boolean(
		process.env.OPENAI_API_KEY?.trim() ||
			process.env.NVIDIA_API_KEY?.trim() ||
			process.env.OMNIROUTE_API_KEY?.trim(),
	);
	const routeReady = routeConfigured;

	const degradedCapabilities: string[] = [];
	if (!browserReady) degradedCapabilities.push("BROWSER_OFFLINE");
	if (!tools.web) degradedCapabilities.push("WEB_SEARCH_OFFLINE");
	if (!knowledgeReady) degradedCapabilities.push("KNOWLEDGE_STORAGE_OFFLINE");

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
			planner: {
				configured: plannerConfigured,
				ready: plannerReady,
				status: plannerReady ? "WORKING_E2E_IN_PREVIEW" : "CONFIGURATION_BLOCKED",
				reason: plannerReady ? null : "No LLM provider configured for planning.",
			},
			agentExecution: {
				configured: runtimeStates.some((s) => s.configured),
				ready: executionReady,
				provider: preferredProvider,
				status: executionReady ? "WORKING_E2E_IN_PREVIEW" : "CONFIGURATION_BLOCKED",
				reason: executionReady ? null : "No execution runtime available.",
			},
			browser: {
				configured: Boolean(process.env.AIRA_BROWSER_RUNTIME_URL),
				ready: browserReady,
				status: browserReady ? "WORKING_E2E_IN_PREVIEW" : "INFRASTRUCTURE_BLOCKED",
				reason: browserReady ? null : "Browser worker offline or unreachable.",
			},
			knowledge: {
				configured: Boolean(process.env.SUPABASE_URL || process.env.DATABASE_URL),
				ready: knowledgeReady,
				status: knowledgeReady ? "WORKING_E2E_IN_PREVIEW" : "INFRASTRUCTURE_BLOCKED",
				reason: knowledgeReady ? null : "Knowledge storage or memory adapter offline.",
			},
			route: {
				configured: routeConfigured,
				ready: routeReady,
				status: routeReady ? "WORKING_E2E_IN_PREVIEW" : "CONFIGURATION_BLOCKED",
				reason: routeReady ? null : "No LLM routing providers configured.",
			},
		},
		checkedAt: new Date().toISOString(),
	});
}

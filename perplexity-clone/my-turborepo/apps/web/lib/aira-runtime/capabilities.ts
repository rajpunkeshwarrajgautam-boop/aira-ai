import { getAgentRuntimeStates } from "@/lib/agent-runtime/registry";
import { runtimeHasControlledTools } from "@/lib/agent-runtime/tool-bridge";
import { getEffectiveEntitlements } from "@/lib/billing/plan-enforcement";
import { toolAvailability } from "@/lib/tool-gateway/gateway";

export interface CapabilityManifest {
	readonly web: boolean;
	readonly browser: boolean;
	readonly files: boolean;
	readonly memory: boolean;
	readonly git: boolean;
	readonly terminal: boolean;
	readonly github: boolean;
	readonly vercel: boolean;
	readonly supabase: boolean;
	readonly mcp: boolean;
	readonly imageGeneration: boolean;
	readonly localModels: boolean;
	readonly autonomousRuns: boolean;
	readonly runtimes: Record<string, {
		readonly enabled: boolean;
		readonly configured: boolean;
		readonly healthy: boolean | null;
		readonly ready: boolean;
		readonly capabilities: Record<string, boolean>;
	}>;
}

function truthy(value: string | undefined): boolean {
	return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export async function buildCapabilityManifest(userId: string): Promise<CapabilityManifest> {
	const [tools, runtimes, entitlements] = await Promise.all([
		toolAvailability(),
		getAgentRuntimeStates().catch(() => []),
		getEffectiveEntitlements(userId).catch(() => null),
	]);
	const runtimeMap = Object.fromEntries(
		runtimes.map((runtime) => [
			runtime.id,
			{
				enabled: runtime.enabled,
				configured: runtime.configured,
				healthy: runtime.healthy,
				ready: runtime.ready,
				capabilities: {
					...runtime.capabilities,
					controlledTools: runtime.ready && runtimeHasControlledTools(runtime.id),
				},
			},
		]),
	);
	return {
		web: tools.web,
		browser: tools.browser,
		files: tools.files,
		memory: tools.memory,
		git: tools.git,
		terminal: tools.terminal,
		github: tools.github,
		vercel: tools.vercel,
		supabase: tools.supabase,
		mcp: tools.mcp,
		imageGeneration: false,
		localModels:
			truthy(process.env.VIREXA_LOCAL_AI_ENABLED) ||
			truthy(process.env.AIRA_LOCAL_FIRST_ENABLED) ||
			Boolean(process.env.SELF_HOSTED_LLM_BASE_URL?.trim()),
		autonomousRuns: Boolean(entitlements && entitlements.monthlyAgentRunLimit > 0 && runtimes.some((runtime) => runtime.ready)),
		runtimes: runtimeMap,
	};
}

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
		// OmniRoute owns inference placement. Do not advertise a local execution
		// capability from retired provider-specific environment variables.
		localModels: false,
		autonomousRuns: Boolean(entitlements && entitlements.monthlyAgentRunLimit > 0 && runtimes.some((runtime) => runtime.ready)),
		runtimes: runtimeMap,
	};
}

import { checkDeerFlowHealth } from "@/lib/deerflow/client";
import {
	getDeerFlowConfig,
	isDeerFlowConfigured,
	isDeerFlowEnabled,
} from "@/lib/deerflow/config";
import {
	cancelDeerFlowAgentRun,
	refreshDeerFlowAgentRun,
	submitDeerFlowAgentRun,
} from "@/lib/deerflow/runs";
import {
	isAutoGptConfigured,
	isAutoGptEnabled,
} from "@/lib/autogpt/config";
import {
	refreshAgentRun,
	submitAgentRun,
} from "@/lib/autogpt/runs";

import { runtimeHasControlledTools } from "./tool-bridge";
import type { AgentRuntime, AgentRuntimeCapabilities, AgentRuntimeHealth } from "./types";

const AUTOGPT_CAPABILITIES: AgentRuntimeCapabilities = {
	cancel: false,
	pause: false,
	resume: false,
	steer: false,
	taskGraph: false,
	spawnAgent: false,
	events: false,
	artifacts: false,
	controlledTools: runtimeHasControlledTools("AUTOGPT"),
};

const DEERFLOW_CAPABILITIES: AgentRuntimeCapabilities = {
	cancel: true,
	pause: false,
	resume: false,
	steer: false,
	taskGraph: false,
	spawnAgent: false,
	events: false,
	artifacts: true,
	controlledTools: runtimeHasControlledTools("DEERFLOW"),
};

export const autoGptRuntime: AgentRuntime = {
	id: "AUTOGPT",
	capabilities: AUTOGPT_CAPABILITIES,
	isEnabled: isAutoGptEnabled,
	isConfigured: isAutoGptConfigured,
	async getHealth(): Promise<AgentRuntimeHealth> {
		const enabled = isAutoGptEnabled();
		const configured = isAutoGptConfigured();
		return {
			id: "AUTOGPT",
			enabled,
			configured,
			healthy: configured ? null : false,
			// Preserve the pre-runtime-registry route semantics: AutoGPT was
			// considered runnable whenever its server configuration was present.
			ready: configured,
			capabilities: AUTOGPT_CAPABILITIES,
		};
	},
	createRun: submitAgentRun,
	refreshRun: refreshAgentRun,
};

export const deerFlowRuntime: AgentRuntime = {
	id: "DEERFLOW",
	capabilities: DEERFLOW_CAPABILITIES,
	isEnabled: isDeerFlowEnabled,
	isConfigured: isDeerFlowConfigured,
	async getHealth(): Promise<AgentRuntimeHealth> {
		const enabled = isDeerFlowEnabled();
		const configured = isDeerFlowConfigured();
		let healthy = false;
		if (configured) {
			try {
				healthy = await checkDeerFlowHealth(getDeerFlowConfig());
			} catch {
				healthy = false;
			}
		}
		return {
			id: "DEERFLOW",
			enabled,
			configured,
			healthy,
			// The previous selector ignored the product flag once the runtime was
			// configured. Keep that behavior during this isolation refactor.
			ready: configured && healthy,
			capabilities: DEERFLOW_CAPABILITIES,
		};
	},
	createRun: submitDeerFlowAgentRun,
	refreshRun: refreshDeerFlowAgentRun,
	cancelRun: cancelDeerFlowAgentRun,
};

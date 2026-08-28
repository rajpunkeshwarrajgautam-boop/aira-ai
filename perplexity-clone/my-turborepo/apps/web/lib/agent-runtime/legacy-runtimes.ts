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
			ready: enabled && configured,
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
			ready: enabled && configured && healthy,
			capabilities: DEERFLOW_CAPABILITIES,
		};
	},
	createRun: submitDeerFlowAgentRun,
	refreshRun: refreshDeerFlowAgentRun,
	cancelRun: cancelDeerFlowAgentRun,
};

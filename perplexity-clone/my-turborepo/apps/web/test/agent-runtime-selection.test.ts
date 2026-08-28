import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_RUNTIME_PRIORITY,
	parseRuntimePriority,
	selectRuntimeId,
} from "../lib/agent-runtime/selection";
import type {
	AgentRuntimeCapabilities,
	AgentRuntimeHealth,
	AgentRuntimeId,
} from "../lib/agent-runtime/types";
import { AgentRuntimeError } from "../lib/agent-runtime/types";

const capabilities: AgentRuntimeCapabilities = {
	cancel: false,
	pause: false,
	resume: false,
	steer: false,
	taskGraph: false,
	spawnAgent: false,
	events: false,
	artifacts: false,
};

function state(id: AgentRuntimeId, ready: boolean): AgentRuntimeHealth {
	return {
		id,
		enabled: ready,
		configured: ready,
		healthy: ready,
		ready,
		capabilities,
	};
}

test("preserves DeerFlow then AutoGPT as the default selection order", () => {
	assert.deepEqual(DEFAULT_RUNTIME_PRIORITY, ["DEERFLOW", "AUTOGPT", "AGENT_SWARM"]);
	assert.equal(
		selectRuntimeId({
			states: [state("AGENT_SWARM", true), state("AUTOGPT", true), state("DEERFLOW", true)],
		}),
		"DEERFLOW",
	);
});

test("falls back without selecting an unready runtime", () => {
	assert.equal(
		selectRuntimeId({
			states: [state("DEERFLOW", false), state("AUTOGPT", true), state("AGENT_SWARM", true)],
		}),
		"AUTOGPT",
	);
});

test("honors an explicitly requested ready runtime", () => {
	assert.equal(
		selectRuntimeId({
			states: [state("DEERFLOW", true), state("AUTOGPT", true), state("AGENT_SWARM", true)],
			requested: "AGENT_SWARM",
		}),
		"AGENT_SWARM",
	);
});

test("fails closed when the requested runtime is not ready", () => {
	assert.throws(
		() =>
			selectRuntimeId({
				states: [state("DEERFLOW", true), state("AUTOGPT", true), state("AGENT_SWARM", false)],
				requested: "AGENT_SWARM",
			}),
		(error: unknown) => error instanceof AgentRuntimeError && error.code === "RUNTIME_DISABLED",
	);
});

test("custom priority is sanitized and always retains safe fallbacks", () => {
	assert.deepEqual(parseRuntimePriority("agent_swarm, deerflow, nonsense, agent_swarm"), [
		"AGENT_SWARM",
		"DEERFLOW",
		"AUTOGPT",
	]);
});

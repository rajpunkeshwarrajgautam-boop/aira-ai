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

function state(
	id: AgentRuntimeId,
	options: { ready: boolean; configured?: boolean; enabled?: boolean },
): AgentRuntimeHealth {
	const configured = options.configured ?? options.ready;
	const enabled = options.enabled ?? options.ready;
	return {
		id,
		enabled,
		configured,
		healthy: options.ready,
		ready: options.ready,
		capabilities,
	};
}

test("preserves DeerFlow then AutoGPT as the default selection order", () => {
	assert.deepEqual(DEFAULT_RUNTIME_PRIORITY, ["DEERFLOW", "AUTOGPT", "AGENT_SWARM"]);
	assert.equal(
		selectRuntimeId({
			states: [
				state("AGENT_SWARM", { ready: true }),
				state("AUTOGPT", { ready: true }),
				state("DEERFLOW", { ready: true }),
			],
		}),
		"DEERFLOW",
	);
});

test("falls back without selecting an unready runtime", () => {
	assert.equal(
		selectRuntimeId({
			states: [
				state("DEERFLOW", { ready: false }),
				state("AUTOGPT", { ready: true }),
				state("AGENT_SWARM", { ready: true }),
			],
		}),
		"AUTOGPT",
	);
});

test("honors an explicitly requested ready runtime", () => {
	assert.equal(
		selectRuntimeId({
			states: [
				state("DEERFLOW", { ready: true }),
				state("AUTOGPT", { ready: true }),
				state("AGENT_SWARM", { ready: true }),
			],
			requested: "AGENT_SWARM",
		}),
		"AGENT_SWARM",
	);
});

test("fails closed when a configured requested runtime is disabled", () => {
	assert.throws(
		() =>
			selectRuntimeId({
				states: [
					state("DEERFLOW", { ready: true }),
					state("AUTOGPT", { ready: true }),
					state("AGENT_SWARM", { ready: false, configured: true, enabled: false }),
				],
				requested: "AGENT_SWARM",
			}),
		(error: unknown) => error instanceof AgentRuntimeError && error.code === "RUNTIME_DISABLED",
	);
});

test("fails closed when the requested runtime is not configured", () => {
	assert.throws(
		() =>
			selectRuntimeId({
				states: [
					state("DEERFLOW", { ready: true }),
					state("AUTOGPT", { ready: true }),
					state("AGENT_SWARM", { ready: false }),
				],
				requested: "AGENT_SWARM",
			}),
		(error: unknown) => error instanceof AgentRuntimeError && error.code === "RUNTIME_NOT_CONFIGURED",
	);
});

test("custom priority is sanitized and always retains safe fallbacks", () => {
	assert.deepEqual(parseRuntimePriority("agent_swarm, deerflow, nonsense, agent_swarm"), [
		"AGENT_SWARM",
		"DEERFLOW",
		"AUTOGPT",
	]);
});

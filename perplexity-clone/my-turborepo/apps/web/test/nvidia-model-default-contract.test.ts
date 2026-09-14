import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_NVIDIA_MODEL, NVIDIAProvider } from "../src/services/providers/nvidia-provider";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("provider-facing NVIDIA model readouts use the provider's real default", () => {
	const provider = read("src/services/providers/nvidia-provider.ts");
	assert.ok(
		provider.includes(
			'export const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct"',
		),
		"the NVIDIA provider must export the verified healthy model it actually uses by default",
	);
	assert.ok(
		!provider.includes("nvidia/nemotron-3-nano-30b-a3b"),
		"the NVIDIA provider must not retain the dead HTTP 410 model",
	);

	for (const relative of [
		"app/api/compare/route.ts",
		"app/api/integrations/status/route.ts",
	]) {
		const source = read(relative);
		assert.ok(
			source.includes("DEFAULT_NVIDIA_MODEL"),
			`${relative} must read NVIDIA's default from the provider`,
		);
		assert.ok(
			!source.includes("nvidia/nemotron-3-nano-30b-a3b"),
			`${relative} must not use the dead HTTP 410 model`,
		);
		assert.ok(
			!source.includes("meta/llama-3.1-70b-instruct"),
			`${relative} must not reintroduce the retired NVIDIA model literal`,
		);
		assert.ok(
			!/NVIDIA_CHAT_MODEL\s*\?\?\s*["'`]/.test(source),
			`${relative} must not maintain a second hardcoded NVIDIA default`,
		);
	}
});

test("Gate 15/16: 410 regression check — retired model is not the active default", () => {
	assert.notEqual(DEFAULT_NVIDIA_MODEL, "nvidia/nemotron-3-nano-30b-a3b");
	assert.notEqual(DEFAULT_NVIDIA_MODEL, "meta/llama-3.1-70b-instruct");
	assert.equal(DEFAULT_NVIDIA_MODEL, "meta/llama-3.2-11b-vision-instruct");
});

test("Gate 16 Failover Scenario A: Primary model 410/unavailable -> fallback succeeds", async () => {
	const provider = new NVIDIAProvider("dummy-key");
	const attemptedModels: string[] = [];

	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (params: { model: string }) => {
					attemptedModels.push(params.model);
					if (params.model === "meta/llama-3.2-11b-vision-instruct") {
						const err = new Error("410 Gone");
						Object.assign(err, { status: 410 });
						throw err;
					}
					// Fallback succeeds
					return (async function* () {
						yield { choices: [{ delta: { content: "healthy-fallback-reply" } }] };
					})();
				},
			},
		},
	};

	let fullText = "";
	for await (const chunk of provider.generateTextStream([{ role: "user", content: "test" }], {})) {
		fullText += chunk;
	}

	assert.equal(fullText, "healthy-fallback-reply");
	assert.equal(attemptedModels[0], "meta/llama-3.2-11b-vision-instruct");
	assert.ok(attemptedModels.length > 1, "Must have attempted fallback model after 410");
});

test("Gate 16 Failover Scenario B: Double failure (all models fail) -> truthful error, no fake answer", async () => {
	const provider = new NVIDIAProvider("dummy-key");
	const attemptedModels: string[] = [];

	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (params: { model: string }) => {
					attemptedModels.push(params.model);
					const err = new Error("Model unavailable");
					Object.assign(err, { status: 404 });
					throw err;
				},
			},
		},
	};

	await assert.rejects(
		async () => {
			for await (const chunk of provider.generateTextStream([{ role: "user", content: "test" }], {})) {
				assert.ok(chunk);
			}
		},
		/Model unavailable/,
		"Must throw truthful error without emitting fake success when all models fail",
	);
	assert.ok(attemptedModels.length >= 2, "Must attempt primary and fallbacks before failing");
});

test("Gate 16 Failover Scenario C: Invalid environment override fails over to approved fallbacks", async () => {
	const provider = new NVIDIAProvider("dummy-key", "invalid-env-override-model");
	const attemptedModels: string[] = [];

	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (params: { model: string }) => {
					attemptedModels.push(params.model);
					if (params.model === "invalid-env-override-model") {
						const err = new Error("unknown model");
						Object.assign(err, { status: 404 });
						throw err;
					}
					return (async function* () {
						yield { choices: [{ delta: { content: "recovered-from-override" } }] };
					})();
				},
			},
		},
	};

	let fullText = "";
	for await (const chunk of provider.generateTextStream([{ role: "user", content: "test" }], {})) {
		fullText += chunk;
	}

	assert.equal(fullText, "recovered-from-override");
	assert.equal(attemptedModels[0], "invalid-env-override-model");
	assert.ok(attemptedModels.length > 1, "Must fall over to next configured model");
});

test("Gate 16 Failover Scenario D: Bounded retry / fallback terminates with no infinite loop", async () => {
	const provider = new NVIDIAProvider("dummy-key");
	let callCount = 0;

	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async () => {
					callCount++;
					const err = new Error("410 Gone");
					Object.assign(err, { status: 410 });
					throw err;
				},
			},
		},
	};

	await assert.rejects(
		async () => {
			for await (const chunk of provider.generateTextStream([{ role: "user", content: "test" }], {})) {
				assert.ok(chunk);
			}
		},
		/410 Gone/,
	);

	// Ensure the loop terminates and call count is bounded to exact number of configured models
	assert.ok(callCount >= 2 && callCount <= 10, `Call count (${callCount}) must be bounded`);
});

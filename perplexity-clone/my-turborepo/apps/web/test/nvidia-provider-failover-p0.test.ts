import assert from "node:assert/strict";
import test from "node:test";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
	DEFAULT_NVIDIA_MODEL,
	NVIDIAProvider,
} from "../src/services/providers/nvidia-provider";
import {
	classifyProviderFailure,
	providerCircuitAllowsRequest,
	recordProviderFailure,
	recordProviderSuccess,
	shouldFailOverProviderError,
} from "../src/services/providers/provider-health";
import {
	ProviderRouter,
	type AIProvider,
	type ProviderOptions,
} from "../src/services/providers/provider-router";

// Mock helper to create synthetic AI providers
function createMockProvider(
	providerId: string,
	handler: (
		messages: ChatCompletionMessageParam[],
		options: ProviderOptions,
	) => AsyncGenerator<string, void, undefined>,
	defaultModel = "mock-default-model",
): AIProvider {
	return {
		providerId,
		defaultModel,
		generateTextStream: handler,
	};
}

test("P0 Proof 1: A retired NVIDIA model is automatically bypassed", async () => {
	// When initialized with a retired model ID, provider safely defaults to verified model
	const provider = new NVIDIAProvider("dummy-key", "meta/llama-3.3-70b-instruct");
	assert.equal(
		provider.defaultModel,
		DEFAULT_NVIDIA_MODEL,
		"Retired model must be redirected to DEFAULT_NVIDIA_MODEL in constructor",
	);

	const attemptedModels: string[] = [];
	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (params: { model: string }) => {
					attemptedModels.push(params.model);
					return (async function* () {
						yield { choices: [{ delta: { content: "verified-nvidia-answer" } }] };
					})();
				},
			},
		},
	};

	let answer = "";
	for await (const chunk of provider.generateTextStream(
		[{ role: "user", content: "test" }],
		{ model: "meta/llama-3.3-70b-instruct" },
	)) {
		answer += chunk;
	}

	assert.equal(answer, "verified-nvidia-answer");
	assert.equal(
		attemptedModels[0],
		DEFAULT_NVIDIA_MODEL,
		"Retired model requested via options must immediately redirect to DEFAULT_NVIDIA_MODEL",
	);
	assert.ok(!attemptedModels.includes("meta/llama-3.3-70b-instruct"));
});

test("P0 Proof 2: A verified accessible NVIDIA model produces an answer", async () => {
	const provider = new NVIDIAProvider("dummy-key", DEFAULT_NVIDIA_MODEL);
	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (params: { model: string }) => {
					assert.equal(params.model, DEFAULT_NVIDIA_MODEL);
					return (async function* () {
						yield { choices: [{ delta: { content: "Aira AI is " } }] };
						yield { choices: [{ delta: { content: "operational." } }] };
					})();
				},
			},
		},
	};

	const chunks: string[] = [];
	for await (const chunk of provider.generateTextStream(
		[{ role: "user", content: "status" }],
		{},
	)) {
		chunks.push(chunk);
	}

	assert.equal(chunks.join(""), "Aira AI is operational.");
	assert.equal(chunks.length, 2);
});

test("P0 Proof 3: Model-chain exhaustion permits eligible OpenAI fallback", async () => {
	const router = new ProviderRouter("nvidia", "openai");

	const nvidiaProvider = createMockProvider(
		"nvidia",
		// eslint-disable-next-line require-yield
		async function* () {
			const exhaustionError = new Error("No accessible NVIDIA chat model is available.");
			Object.assign(exhaustionError, {
				status: 410,
				code: "MODEL_UNAVAILABLE",
			});
			throw exhaustionError;
		},
		DEFAULT_NVIDIA_MODEL,
	);

	const openAiProvider = createMockProvider(
		"openai",
		async function* () {
			yield "OpenAI fallback response.";
		},
		"gpt-4o",
	);

	router.registerProvider(nvidiaProvider);
	router.registerProvider(openAiProvider);

	let fullAnswer = "";
	for await (const chunk of router.streamChat([{ role: "user", content: "search query" }])) {
		fullAnswer += chunk;
	}

	assert.equal(fullAnswer, "OpenAI fallback response.");
});

test("P0 Proof 4: Temporary overload follows bounded retry/fallback policy and circuit breaker", () => {
	const overloadError = Object.assign(new Error("Service temporarily overloaded"), { status: 503 });
	assert.equal(classifyProviderFailure(overloadError), "transient");
	assert.equal(shouldFailOverProviderError(overloadError), true);

	const testProviderId = `nvidia-overload-${Date.now()}`;
	assert.equal(providerCircuitAllowsRequest(testProviderId), true);

	// Record failures to trigger circuit breaker (THRESHOLD = 3)
	recordProviderFailure(testProviderId, overloadError);
	recordProviderFailure(testProviderId, overloadError);
	assert.equal(providerCircuitAllowsRequest(testProviderId), true);

	recordProviderFailure(testProviderId, overloadError);
	// After 3 consecutive failures, circuit must open
	assert.equal(providerCircuitAllowsRequest(testProviderId), false, "Circuit must open after 3 failures");

	// Recording success clears the circuit
	recordProviderSuccess(testProviderId);
	assert.equal(providerCircuitAllowsRequest(testProviderId), true, "Success resets circuit");
});

test("P0 Proof 5: Missing credentials do not falsely pass readiness", () => {
	const authError = Object.assign(new Error("Invalid API key provided"), { status: 401 });
	assert.equal(classifyProviderFailure(authError), "credentials");
	assert.equal(shouldFailOverProviderError(authError), true);

	// Empty router has no configured route
	const emptyRouter = new ProviderRouter("nvidia", "openai");
	assert.equal(emptyRouter.hasConfiguredRoute(), false, "Router with no registered keys must report no configured route");
});

test("P0 Proof 6: Residency-denied providers are never used", async () => {
	const residencyError = new Error("Residency policy violation: provider geo-restricted");
	assert.equal(classifyProviderFailure(residencyError), "residency");
	assert.equal(shouldFailOverProviderError(residencyError), false, "Residency violation must never fail over");

	const router = new ProviderRouter("nvidia", "openai");
	// eslint-disable-next-line require-yield
	const nvidiaProvider = createMockProvider("nvidia", async function* () {
		throw residencyError;
	});
	const openAiProvider = createMockProvider("openai", async function* () {
		yield "unintended OpenAI response";
	});

	router.registerProvider(nvidiaProvider);
	router.registerProvider(openAiProvider);

	await assert.rejects(
		async () => {
			for await (const chunk of router.streamChat([{ role: "user", content: "test" }])) {
				assert.ok(chunk);
			}
		},
		/Residency policy violation/,
		"Residency violation must terminate without cross-provider fallback",
	);
});

test("P0 Proof 7: No published partial response is duplicated during fallback", async () => {
	const router = new ProviderRouter("nvidia", "openai");

	let openAiCalled = false;
	const nvidiaProvider = createMockProvider("nvidia", async function* () {
		yield "Partial chunk already sent to user.";
		throw new Error("Mid-stream connection reset (ECONNRESET)");
	});
	const openAiProvider = createMockProvider("openai", async function* () {
		openAiCalled = true;
		yield "Duplicate stream start.";
	});

	router.registerProvider(nvidiaProvider);
	router.registerProvider(openAiProvider);

	const receivedChunks: string[] = [];
	await assert.rejects(
		async () => {
			for await (const chunk of router.streamChat([{ role: "user", content: "test" }])) {
				receivedChunks.push(chunk);
			}
		},
		/Mid-stream connection reset/,
		"Router must rethrow error and NOT fallback once output has already been yielded",
	);

	assert.equal(receivedChunks.length, 1);
	assert.equal(receivedChunks[0], "Partial chunk already sent to user.");
	assert.equal(openAiCalled, false, "OpenAI fallback must not be called after partial output is published");
});

test("P0 Proof 8: Successful streaming delivers text and clean completion", async () => {
	const router = new ProviderRouter("nvidia", "openai");
	const nvidiaProvider = createMockProvider("nvidia", async function* () {
		yield "First sentence. ";
		yield "Second sentence. ";
		yield "Done.";
	});
	router.registerProvider(nvidiaProvider);

	const chunks: string[] = [];
	for await (const chunk of router.streamChat([{ role: "user", content: "hello" }])) {
		chunks.push(chunk);
	}

	assert.equal(chunks.join(""), "First sentence. Second sentence. Done.");
	assert.equal(chunks.length, 3);
});

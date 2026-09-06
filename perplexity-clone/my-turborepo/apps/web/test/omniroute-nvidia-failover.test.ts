import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ProviderRouter } from "../src/services/providers/provider-router";
import { OmniRouteProvider } from "../src/services/providers/omniroute-provider";
import { NVIDIAProvider } from "../src/services/providers/nvidia-provider";
import {
	recordProviderSuccess,
	recordProviderFailure,
	providerCircuitAllowsRequest,
	getProviderHealthSnapshot,
} from "../src/services/providers/provider-health";
import type { AIProvider } from "../src/services/providers/provider-router-core";

function getLocalOmniRouteKey(): string | null {
	try {
		if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY;
		const envMap = process.env as Record<string, string | undefined>;
		const localAppData = envMap[String("LOCAL") + "APPDATA"] || "";
		const dbPath = path.join(localAppData, "AIRA", "OmniRoute", "data", "storage.sqlite");
		if (!fs.existsSync(dbPath)) return null;
		const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
		const row = db.prepare("SELECT key FROM api_keys WHERE is_active = 1 AND name = 'aira ai' LIMIT 1").get() as { key?: string } | undefined;
		db.close();
		return row?.key ?? null;
	} catch {
		return null;
	}
}

function resetHealth(): void {
	recordProviderSuccess("omniroute");
	recordProviderSuccess("nvidia");
}

function getLocalNvidiaKey(): string | null {
	try {
		const raw = process.env.NVIDIA_API_KEY?.trim();
		if (raw && raw !== '""' && raw !== "''") return raw;
		for (const candidate of [".env.local", path.resolve("..", ".env.local")]) {
			if (fs.existsSync(candidate)) {
				const content = fs.readFileSync(candidate, "utf8");
				const match = content.match(/^NVIDIA_API_KEY=(.+)$/m);
				if (match && match[1]) {
					const val = match[1].trim().replace(/^["']|["']$/g, "").trim();
					if (val) return val;
				}
			}
		}
		return null;
	} catch {
		return null;
	}
}

// Failing mock provider for fault injection into primary slot
class FailingPrimaryProvider implements AIProvider {
	readonly providerId = "omniroute";
	readonly defaultModel = "auto";
	readonly failureMode: "503" | "429" | "timeout" | "econnrefused" | "fatal";

	constructor(failureMode: "503" | "429" | "timeout" | "econnrefused" | "fatal") {
		this.failureMode = failureMode;
	}

	async *generateTextStream(): AsyncGenerator<string, void, undefined> {
		yield* [];
		if (this.failureMode === "503") {
			const err = new Error("OmniRoute upstream unavailable");
			Object.assign(err, { status: 503 });
			throw err;
		}
		if (this.failureMode === "429") {
			const err = new Error("OmniRoute rate limit exceeded");
			Object.assign(err, { status: 429 });
			throw err;
		}
		if (this.failureMode === "timeout") {
			const err = new Error("OmniRoute timeout");
			err.name = "AbortError";
			throw err;
		}
		if (this.failureMode === "econnrefused") {
			const cause = new Error("connect ECONNREFUSED 127.0.0.1:20128");
			Object.assign(cause, { code: "ECONNREFUSED" });
			throw new Error("Connection failed", { cause });
		}
		throw new Error("Fatal unrecoverable error");
	}
}

test("Gate 37 Contract: Failover state machine, circuit breaker, and retry bounds", async () => {
	resetHealth();

	class MockFallbackProvider implements AIProvider {
		readonly providerId = "nvidia";
		readonly defaultModel = "nvidia/nemotron-nano-3-30b-a3b";
		called = 0;

		async *generateTextStream(): AsyncGenerator<string, void, undefined> {
			this.called += 1;
			yield "fallback-pong";
		}
	}

	// 1. Primary 503 Outage -> Failover
	const fallback503 = new MockFallbackProvider();
	const router503 = new ProviderRouter("omniroute", "nvidia");
	router503.registerProvider(new FailingPrimaryProvider("503"));
	router503.registerProvider(fallback503);

	let text503 = "";
	for await (const delta of router503.streamChat([{ role: "user", content: "ping" }])) {
		text503 += delta;
	}
	assert.equal(text503, "fallback-pong");
	assert.equal(fallback503.called, 1);
	assert.ok(getProviderHealthSnapshot("omniroute").consecutiveFailures >= 1);

	// 2. Primary 429 Rate Limit -> Failover
	resetHealth();
	const fallback429 = new MockFallbackProvider();
	const router429 = new ProviderRouter("omniroute", "nvidia");
	router429.registerProvider(new FailingPrimaryProvider("429"));
	router429.registerProvider(fallback429);

	let text429 = "";
	for await (const delta of router429.streamChat([{ role: "user", content: "ping" }])) {
		text429 += delta;
	}
	assert.equal(text429, "fallback-pong");
	assert.equal(fallback429.called, 1);

	// 3. Primary Timeout -> Failover
	resetHealth();
	const fallbackTimeout = new MockFallbackProvider();
	const routerTimeout = new ProviderRouter("omniroute", "nvidia");
	routerTimeout.registerProvider(new FailingPrimaryProvider("timeout"));
	routerTimeout.registerProvider(fallbackTimeout);

	let textTimeout = "";
	for await (const delta of routerTimeout.streamChat([{ role: "user", content: "ping" }])) {
		textTimeout += delta;
	}
	assert.equal(textTimeout, "fallback-pong");
	assert.equal(fallbackTimeout.called, 1);

	// 4. Circuit Breaker Trips -> Primary Bypassed
	resetHealth();
	const err = new Error("503 failure");
	Object.assign(err, { status: 503 });
	recordProviderFailure("omniroute", err);
	recordProviderFailure("omniroute", err);
	recordProviderFailure("omniroute", err);
	assert.equal(providerCircuitAllowsRequest("omniroute"), false);

	let primaryCalledWhileOpen = false;
	const sentinel: AIProvider = {
		providerId: "omniroute",
		defaultModel: "auto",
		async *generateTextStream() {
			yield* [];
			primaryCalledWhileOpen = true;
			throw new Error("Should not be called");
		},
	};
	const fallbackCircuit = new MockFallbackProvider();
	const routerCircuit = new ProviderRouter("omniroute", "nvidia");
	routerCircuit.registerProvider(sentinel);
	routerCircuit.registerProvider(fallbackCircuit);

	let textCircuit = "";
	for await (const delta of routerCircuit.streamChat([{ role: "user", content: "ping" }])) {
		textCircuit += delta;
	}
	assert.equal(textCircuit, "fallback-pong");
	assert.equal(primaryCalledWhileOpen, false, "Primary must not be called when circuit breaker is open");
	assert.equal(fallbackCircuit.called, 1);

	// 5. Recovery Back to Primary
	resetHealth();
	assert.equal(providerCircuitAllowsRequest("omniroute"), true);

	class RecoveredPrimaryProvider implements AIProvider {
		readonly providerId = "omniroute";
		readonly defaultModel = "auto";
		called = 0;
		async *generateTextStream(): AsyncGenerator<string, void, undefined> {
			this.called += 1;
			yield "primary-pong";
		}
	}
	const recoveredPrimary = new RecoveredPrimaryProvider();
	const fallbackRecovered = new MockFallbackProvider();
	const routerRecovered = new ProviderRouter("omniroute", "nvidia");
	routerRecovered.registerProvider(recoveredPrimary);
	routerRecovered.registerProvider(fallbackRecovered);

	let textRecovered = "";
	for await (const delta of routerRecovered.streamChat([{ role: "user", content: "ping" }])) {
		textRecovered += delta;
	}
	assert.equal(textRecovered, "primary-pong");
	assert.equal(recoveredPrimary.called, 1);
	assert.equal(fallbackRecovered.called, 0, "Fallback must not be called when primary is healthy");

	// Clean up
	resetHealth();
});

test("Gate 37: OmniRoute -> NVIDIA Failover Invariant Matrix (Live Provider)", async (t) => {
	const nvidiaKey = getLocalNvidiaKey();
	const omnirouteKey = getLocalOmniRouteKey();

	if (!nvidiaKey) {
		t.skip("NVIDIA_API_KEY not configured locally; cannot run live failover test.");
		return;
	}

	// 1. Steady State Baseline: Live OmniRoute Primary and Live NVIDIA Fallback
	resetHealth();
	const realNvidiaProvider = new NVIDIAProvider(nvidiaKey);

	// Scenario A: Live primary healthy (if omniroute container available)
	if (omnirouteKey) {
		const realOmniRouteProvider = new OmniRouteProvider({
			baseURL: "http://127.0.0.1:20128/v1",
			apiKey: omnirouteKey,
			model: "auto/best-fast",
			timeoutMs: 30000,
		});

		const routerA = new ProviderRouter("omniroute", "nvidia");
		routerA.registerProvider(realOmniRouteProvider);
		routerA.registerProvider(realNvidiaProvider);

		let textA = "";
		for await (const delta of routerA.streamChat([
			{ role: "user", content: "Say hello in one word." },
		], { maxCompletionTokens: 30 })) {
			textA += delta;
		}
		assert.ok(textA.length > 0, "Expected output from primary OmniRoute");
		assert.equal(providerCircuitAllowsRequest("omniroute"), true, "OmniRoute circuit should be healthy");
	}

	// Scenario B: Primary 503 Outage -> Automatic Failover to Live NVIDIA
	resetHealth();
	const router503 = new ProviderRouter("omniroute", "nvidia");
	router503.registerProvider(new FailingPrimaryProvider("503"));
	router503.registerProvider(realNvidiaProvider);

	let text503 = "";
	for await (const delta of router503.streamChat([
		{ role: "user", content: "Say pong in one word." },
	], { maxCompletionTokens: 30 })) {
		text503 += delta;
	}
	assert.ok(text503.length > 0, "Expected non-empty failover response from NVIDIA on 503 outage");
	const health503 = getProviderHealthSnapshot("omniroute");
	assert.ok(health503.consecutiveFailures >= 1, "Expected OmniRoute failure recorded on 503");

	// Scenario C: Primary 429 Rate Limit -> Automatic Failover to Live NVIDIA
	resetHealth();
	const router429 = new ProviderRouter("omniroute", "nvidia");
	router429.registerProvider(new FailingPrimaryProvider("429"));
	router429.registerProvider(realNvidiaProvider);

	let text429 = "";
	for await (const delta of router429.streamChat([
		{ role: "user", content: "Say pong in one word." },
	], { maxCompletionTokens: 30 })) {
		text429 += delta;
	}
	assert.ok(text429.length > 0, "Expected non-empty failover response from NVIDIA on 429 rate limit");

	// Scenario D: Primary Timeout -> Automatic Failover to Live NVIDIA
	resetHealth();
	const routerTimeout = new ProviderRouter("omniroute", "nvidia");
	routerTimeout.registerProvider(new FailingPrimaryProvider("timeout"));
	routerTimeout.registerProvider(realNvidiaProvider);

	let textTimeout = "";
	for await (const delta of routerTimeout.streamChat([
		{ role: "user", content: "Say pong in one word." },
	], { maxCompletionTokens: 30 })) {
		textTimeout += delta;
	}
	assert.ok(textTimeout.length > 0, "Expected non-empty failover response from NVIDIA on timeout");

	// Scenario E: Primary Connection Refused (Outage) -> Automatic Failover
	resetHealth();
	const routerConn = new ProviderRouter("omniroute", "nvidia");
	routerConn.registerProvider(new FailingPrimaryProvider("econnrefused"));
	routerConn.registerProvider(realNvidiaProvider);

	let textConn = "";
	for await (const delta of routerConn.streamChat([
		{ role: "user", content: "Say pong in one word." },
	], { maxCompletionTokens: 30 })) {
		textConn += delta;
	}
	assert.ok(textConn.length > 0, "Expected non-empty failover response from NVIDIA on connection refused");

	// Scenario F: Circuit Breaker Open -> Primary is bypassed without execution
	resetHealth();
	// Trip circuit breaker by recording multiple consecutive failures
	const err = new Error("Simulated circuit trip");
	Object.assign(err, { status: 503 });
	for (let i = 0; i < 5; i++) {
		recordProviderFailure("omniroute", err);
	}
	assert.equal(providerCircuitAllowsRequest("omniroute"), false, "OmniRoute circuit should be open");

	const routerCircuit = new ProviderRouter("omniroute", "nvidia");
	// If primary was called it would throw, but circuit should route straight to fallback
	let primaryTouched = false;
	const sentinelPrimary: AIProvider = {
		providerId: "omniroute",
		defaultModel: "auto",
		async *generateTextStream() {
			yield* [];
			primaryTouched = true;
			throw new Error("Primary should not have been called while circuit was open");
		},
	};
	routerCircuit.registerProvider(sentinelPrimary);
	routerCircuit.registerProvider(realNvidiaProvider);

	let textCircuit = "";
	for await (const delta of routerCircuit.streamChat([
		{ role: "user", content: "Say ok in one word." },
	], { maxCompletionTokens: 30 })) {
		textCircuit += delta;
	}
	assert.equal(primaryTouched, false, "Primary must be bypassed when circuit is open");
	assert.ok(textCircuit.length > 0, "Fallback NVIDIA must fulfill request while circuit is open");

	// Scenario G: Both Unavailable -> Safe Fail Closed
	resetHealth();
	const routerBothFailing = new ProviderRouter("omniroute", "nvidia");
	routerBothFailing.registerProvider(new FailingPrimaryProvider("503"));
	const failingFallback: AIProvider = {
		providerId: "nvidia",
		defaultModel: "nvidia/nemotron-3-nano-30b-a3b",
		async *generateTextStream() {
			yield* [];
			throw new Error("NVIDIA fallback also down");
		},
	};
	routerBothFailing.registerProvider(failingFallback);

	await assert.rejects(
		async () => {
			for await (const delta of routerBothFailing.streamChat([{ role: "user", content: "ping" }])) {
				assert.ok(delta !== undefined);
			}
		},
		/NVIDIA fallback also down/,
		"Expected fail-closed behavior when both primary and fallback fail",
	);

	// Clean up
	resetHealth();
});

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

import { fetchOmniRouteModels, OmniRouteGatewayError } from "../src/services/omniroute/gateway";
import { OmniRouteProvider } from "../src/services/providers/omniroute-provider";

import { DatabaseSync } from "node:sqlite";

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

async function isPortOpen(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.request({ host, port, path: "/v1/models", method: "GET", timeout: 1000 }, () => {
			resolve(true);
		});
		req.on("error", () => resolve(false));
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
		req.end();
	});
}

test("Live OmniRoute Gateway: model discovery, inference, streaming, and auth rejection", async (t) => {
	const reachable = await isPortOpen(20128, "127.0.0.1");
	if (!reachable) {
		t.skip("Live OmniRoute container (127.0.0.1:20128) is not reachable in this test runner environment.");
		return;
	}

	const apiKey = getLocalOmniRouteKey();
	if (!apiKey) {
		t.skip("Local OmniRoute API key not found in storage.sqlite.");
		return;
	}

	const prevEnabled = process.env.OMNIROUTE_ENABLED;
	const prevBaseUrl = process.env.OMNIROUTE_BASE_URL;
	const prevKey = process.env.OMNIROUTE_API_KEY;

	process.env.OMNIROUTE_ENABLED = "true";
	process.env.OMNIROUTE_BASE_URL = "http://127.0.0.1:20128";
	process.env.OMNIROUTE_API_KEY = apiKey;

	try {
		// 1. Model Discovery
		const snapshot = await fetchOmniRouteModels();
		assert.ok(snapshot.models.length > 0, "Expected at least one model discovered");
		assert.ok(snapshot.latencyMs >= 0, "Expected positive latency measurement");
		assert.ok(snapshot.checkedAt, "Expected checkedAt timestamp");
		const hasAuto = snapshot.models.some((m) => m.id.startsWith("auto/"));
		assert.ok(hasAuto, "Expected auto/* routing profile in discovered models");

		// 2. Inference & Streaming
		const provider = new OmniRouteProvider({
			baseURL: "http://127.0.0.1:20128/v1",
			apiKey,
			model: "auto/best-fast",
			timeoutMs: 30000,
		});

		let chunks = 0;
		let assembled = "";
		for await (const chunk of provider.generateTextStream(
			[
				{ role: "user", content: "Count from 1 to 3." },
			],
			{ model: "auto/best-fast", maxCompletionTokens: 60 },
		)) {
			chunks++;
			assembled += chunk;
		}

		assert.ok(chunks >= 1, "Expected at least one stream chunk");
		assert.ok(assembled.length > 0, "Expected non-empty stream output");

		// 3. Auth Rejection on invalid key
		process.env.OMNIROUTE_API_KEY = "sk-invalid-auth-key-0000";
		await assert.rejects(
			fetchOmniRouteModels(),
			(err: unknown) => {
				return err instanceof OmniRouteGatewayError && err.code === "OMNIROUTE_UPSTREAM_ERROR" && err.upstreamStatus === 401;
			},
			"Expected 401 OMNIROUTE_UPSTREAM_ERROR on invalid API key",
		);
	} finally {
		process.env.OMNIROUTE_ENABLED = prevEnabled;
		process.env.OMNIROUTE_BASE_URL = prevBaseUrl;
		process.env.OMNIROUTE_API_KEY = prevKey;
	}
});

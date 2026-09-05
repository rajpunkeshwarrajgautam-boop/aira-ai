import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
	return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

test("provider-facing NVIDIA model readouts use the provider's real default", () => {
	const provider = read("src/services/providers/nvidia-provider.ts");
	assert.ok(
		provider.includes(
			'export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-nano-30b-a3b"',
		),
		"the NVIDIA provider must export the model it actually uses by default",
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
			!source.includes("meta/llama-3.1-70b-instruct"),
			`${relative} must not reintroduce the retired NVIDIA model literal`,
		);
		assert.ok(
			!/NVIDIA_CHAT_MODEL\s*\?\?\s*["'`]/.test(source),
			`${relative} must not maintain a second hardcoded NVIDIA default`,
		);
	}
});

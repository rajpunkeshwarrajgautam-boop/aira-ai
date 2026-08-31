import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gatewaySource = readFileSync(new URL("../lib/tool-gateway/gateway.ts", import.meta.url), "utf8");

test("Tool Gateway idempotency binds a request id to the exact agent identity", () => {
	assert.match(
		gatewaySource,
		/stored\.agentId\s*!==\s*\(context\.agentId\s*\?\?\s*null\)/,
		"a second agent on the same task must not replay another agent's ToolCall identity",
	);
});

test("Tool Gateway exact-operation conflict binds every authoritative scope", () => {
	for (const binding of [
		/stored\.tool\s*!==\s*request\.tool/,
		/stored\.action\s*!==\s*request\.action/,
		/stored\.runId\s*!==\s*context\.runId/,
		/stored\.projectId\s*!==\s*context\.projectId/,
		/stored\.taskId\s*!==\s*\(context\.taskId\s*\?\?\s*null\)/,
		/stored\.agentId\s*!==\s*\(context\.agentId\s*\?\?\s*null\)/,
		/stored\.inputHash\s*!==\s*inputHash/,
	]) {
		assert.match(gatewaySource, binding);
	}
	assert.match(gatewaySource, /code:\s*"TOOL_IDEMPOTENCY_CONFLICT"/);
});

test("concurrent create collisions are revalidated against the same full operation identity", () => {
	assert.match(gatewaySource, /function storedOperationConflicts\(/);
	const uses = gatewaySource.match(/storedOperationConflicts\(stored, context, request, inputHash\)/g) ?? [];
	assert.ok(uses.length >= 2, "the operation identity must be checked both before and after createToolCall");
	assert.match(
		gatewaySource,
		/createToolCall\([\s\S]*?storedOperationConflicts\(stored, context, request, inputHash\)[\s\S]*?Concurrent tool request id collision detected across different operation scope/,
	);
});

test("execution-state races also revalidate full scope before replay", () => {
	assert.match(
		gatewaySource,
		/if \(!latest \|\| storedOperationConflicts\(latest, context, request, inputHash\)\)/,
	);
});

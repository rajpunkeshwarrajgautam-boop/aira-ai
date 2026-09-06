import assert from "node:assert/strict";
import test from "node:test";

import { POST as genericGatewayPost } from "../app/api/internal/tool-gateway/execute/route";
import { POST as runtimeGatewayPost } from "../app/api/internal/tool-gateway/runtime/route";

const GENERIC_TOKEN = "generic-tool-gateway-token-1234567890";
const RUNTIME_TOKEN = "runtime-tool-gateway-token-1234567890";

function request(token: string): Request {
	return new Request("http://localhost/api/internal/tool-gateway/test", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({}),
	});
}

test("generic and restricted runtime Tool Gateway credentials are not interchangeable", async () => {
	const previousGeneric = process.env.AIRA_TOOL_GATEWAY_TOKEN;
	const previousRuntime = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN;
	const previousEnabled = process.env.AIRA_TOOL_GATEWAY_ENABLED;
	process.env.AIRA_TOOL_GATEWAY_TOKEN = GENERIC_TOKEN;
	process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = RUNTIME_TOKEN;
	process.env.AIRA_TOOL_GATEWAY_ENABLED = "true";
	try {
		const genericWithRuntime = await genericGatewayPost(request(RUNTIME_TOKEN));
		assert.equal(genericWithRuntime.status, 401);
		assert.equal((await genericWithRuntime.json()).error.code, "UNAUTHORIZED");

		const runtimeWithGeneric = await runtimeGatewayPost(request(GENERIC_TOKEN));
		assert.equal(runtimeWithGeneric.status, 401);
		assert.equal((await runtimeWithGeneric.json()).error.code, "UNAUTHORIZED");

		// A matching credential must cross the authentication boundary. The empty
		// request body then fails validation before any database/tool execution,
		// proving this test exercises the real endpoint auth logic without side effects.
		const genericWithGeneric = await genericGatewayPost(request(GENERIC_TOKEN));
		assert.equal(genericWithGeneric.status, 400);
		assert.equal((await genericWithGeneric.json()).error.code, "VALIDATION_ERROR");

		const runtimeWithRuntime = await runtimeGatewayPost(request(RUNTIME_TOKEN));
		assert.equal(runtimeWithRuntime.status, 400);
		assert.equal((await runtimeWithRuntime.json()).error.code, "VALIDATION_ERROR");
	} finally {
		if (previousGeneric === undefined) delete process.env.AIRA_TOOL_GATEWAY_TOKEN;
		else process.env.AIRA_TOOL_GATEWAY_TOKEN = previousGeneric;
		if (previousRuntime === undefined) delete process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN;
		else process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = previousRuntime;
		if (previousEnabled === undefined) delete process.env.AIRA_TOOL_GATEWAY_ENABLED;
		else process.env.AIRA_TOOL_GATEWAY_ENABLED = previousEnabled;
	}
});

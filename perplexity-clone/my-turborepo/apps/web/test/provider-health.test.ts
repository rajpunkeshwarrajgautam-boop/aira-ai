import assert from "node:assert/strict";
import test from "node:test";

import {
	classifyProviderFailure,
	shouldFailOverProviderError,
} from "../src/services/providers/provider-health";

test("fails over when a provider SDK wraps a transient socket code in its cause", () => {
	const socketError = Object.assign(new Error("TLS socket disconnected"), {
		code: "ECONNRESET",
	});
	const providerError = new Error("Connection error.", { cause: socketError });

	assert.equal(classifyProviderFailure(providerError), "transient");
	assert.equal(shouldFailOverProviderError(providerError), true);
});

test("bounds cyclic cause traversal and preserves fatal classification", () => {
	const providerError = new Error("Unexpected provider response") as Error & {
		cause?: unknown;
	};
	providerError.cause = providerError;

	assert.equal(classifyProviderFailure(providerError), "fatal");
	assert.equal(shouldFailOverProviderError(providerError), false);
});

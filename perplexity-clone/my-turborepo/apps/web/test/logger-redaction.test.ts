import test from "node:test";
import assert from "node:assert/strict";
import { redactString, redactValue, logger } from "@/lib/logger";

test("logger redaction: sanitizes raw secret patterns in strings", () => {
	const openaiKey = "sk-abcdef1234567890abcdef1234567890";
	const nvidiaKey = "nvapi-1234567890abcdef1234567890abcdef";
	const dbUrl = "postgresql://postgres:mysecretpassword@db.project.supabase.co:5432/postgres";

	assert.equal(redactString(`Using key ${openaiKey}`), "Using key [REDACTED_SECRET]");
	assert.equal(redactString(`Nvidia key is ${nvidiaKey}`), "Nvidia key is [REDACTED_SECRET]");
	assert.equal(redactString(`Connect to ${dbUrl}`), "Connect to [REDACTED_SECRET]/postgres");
});

test("logger redaction: redacts sensitive keys recursively in objects", () => {
	const payload = {
		apiKey: "secret-key-123",
		password: "superpassword",
		authorization: "Bearer some.jwt.token",
		nested: {
			database_url: "postgres://user:pass@host/db",
			safeField: "safe value",
		},
		query: "A".repeat(150),
	};

	const redacted = redactValue("metadata", payload) as Record<string, unknown>;

	assert.equal(redacted.apiKey, "[REDACTED]");
	assert.equal(redacted.password, "[REDACTED]");
	assert.equal(redacted.authorization, "[REDACTED]");
	const nested = redacted.nested as Record<string, unknown>;
	assert.equal(nested.database_url, "[REDACTED]");
	assert.equal(nested.safeField, "safe value");

	// Query is truncated to prevent prompt dumping
	assert.ok(typeof redacted.query === "string");
	assert.ok(redacted.query.includes("[TRUNCATED]"));
	assert.ok(redacted.query.length < 110);
});

test("logger: writes structured entries without throwing", () => {
	assert.doesNotThrow(() => {
		logger.info("Test info message", { route: "/api/test", status: 200 });
		logger.clientError("Malformed JSON probe", {
			route: "/api/search",
			status: 400,
			category: "4xx.CLIENT_INPUT",
			errorCode: "INVALID_JSON",
		});
		logger.error("Test internal failure", {
			route: "/api/search",
			status: 500,
			category: "5xx.INTERNAL",
		});
	});
});

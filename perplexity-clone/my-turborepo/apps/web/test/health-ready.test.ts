import test from "node:test";
import assert from "node:assert/strict";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as readyGet } from "@/app/api/ready/route";

test("health endpoint: responds 200 with service and uptime", async () => {
	const res = healthGet();
	assert.equal(res.status, 200);

	const body = await res.json();
	assert.equal(body.status, "ok");
	assert.equal(body.service, "aira-ai");
	assert.ok(typeof body.uptime === "number");
	assert.ok(body.timestamp);
});

test("ready endpoint: returns structured readiness payload without leaking secrets", async () => {
	const res = await readyGet();
	assert.ok([200, 503].includes(res.status));

	const body = await res.json();
	assert.ok(["ready", "not_ready"].includes(body.status));
	assert.ok(body.checks);
	assert.ok(typeof body.checks.providersConfigured === "boolean");
	assert.ok(typeof body.checks.authConfigured === "boolean");
	assert.ok(typeof body.checks.database === "string");

	const rawJson = JSON.stringify(body);
	assert.ok(!rawJson.includes("sk-"));
	assert.ok(!rawJson.includes("postgres"));
	assert.ok(!rawJson.includes("nvapi-"));
});

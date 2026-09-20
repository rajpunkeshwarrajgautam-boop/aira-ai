import assert from "node:assert/strict";
import test from "node:test";
import { WorkRuntimeWorker } from "../src/worker";

test("WorkRuntimeWorker initializes with default configuration and resolves telemetry", () => {
	const worker = new WorkRuntimeWorker({
		workerId: "worker:test:unit:1",
		concurrency: 2,
		pollIntervalMs: 500,
		idleIntervalMs: 1000,
		runOnce: true,
	});

	const metrics = worker.getMetrics();
	assert.equal(metrics.workerId, "worker:test:unit:1");
	assert.equal(metrics.status, "STARTING");
	assert.equal(metrics.totalTicks, 0);
	assert.equal(metrics.totalAttempted, 0);
	assert.equal(metrics.totalAdvanced, 0);
	assert.equal(metrics.totalFailures, 0);
	assert.equal(metrics.consecutiveErrors, 0);
	assert.ok(metrics.startedAt);
	assert.ok(metrics.lastHeartbeatAt);
});

test("WorkRuntimeWorker single tick completes safely without crashing", async () => {
	const worker = new WorkRuntimeWorker({
		workerId: "worker:test:tick:1",
		concurrency: 1,
		pollIntervalMs: 500,
		idleIntervalMs: 1000,
		runOnce: true,
	});

	const tickResult = await worker.tick();
	assert.equal(typeof tickResult.attempted, "number");
	assert.equal(typeof tickResult.advanced, "number");
	assert.equal(typeof tickResult.failures, "number");

	const metrics = worker.getMetrics();
	assert.equal(metrics.totalTicks, 1);
	assert.ok(metrics.lastHeartbeatAt);
});

test("WorkRuntimeWorker graceful shutdown stops loop cleanly", async () => {
	const worker = new WorkRuntimeWorker({
		workerId: "worker:test:shutdown:1",
		concurrency: 1,
		pollIntervalMs: 200,
		idleIntervalMs: 500,
		runOnce: false,
	});

	const startPromise = worker.start();
	// Give loop a tick to enter RUNNING
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(worker.getMetrics().status, "RUNNING");

	await worker.shutdown();
	await startPromise;

	assert.equal(worker.getMetrics().status, "STOPPED");
});

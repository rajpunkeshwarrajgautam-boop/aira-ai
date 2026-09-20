import fs from "node:fs";
if (fs.existsSync(".env.local")) { try { process.loadEnvFile(".env.local"); } catch (_err) { /* ignore */ } }
import crypto from "node:crypto";
import os from "node:os";
import process from "node:process";
import { advanceScheduledRuns } from "@/lib/agent-platform/scheduler";
import { recoverExpiredClaims } from "@/lib/agent-platform/store";

export interface WorkerConfig {
	readonly workerId: string;
	readonly concurrency: number;
	readonly pollIntervalMs: number;
	readonly idleIntervalMs: number;
	readonly maxBackoffMs: number;
	readonly runOnce: boolean;
}

export interface WorkerMetrics {
	readonly workerId: string;
	readonly status: "STARTING" | "RUNNING" | "STOPPING" | "STOPPED";
	readonly uptimeSeconds: number;
	readonly startedAt: string;
	readonly lastHeartbeatAt: string;
	readonly totalTicks: number;
	readonly totalAttempted: number;
	readonly totalAdvanced: number;
	readonly totalFailures: number;
	readonly consecutiveErrors: number;
}

function resolveWorkerConfig(): WorkerConfig {
	const rawConcurrency = Number(process.env.AIRA_WORKER_CONCURRENCY ?? "4");
	const concurrency = Number.isFinite(rawConcurrency) ? Math.max(1, Math.min(20, Math.trunc(rawConcurrency))) : 4;

	const rawPoll = Number(process.env.AIRA_WORKER_POLL_INTERVAL_MS ?? "1000");
	const pollIntervalMs = Number.isFinite(rawPoll) ? Math.max(250, Math.min(30000, Math.trunc(rawPoll))) : 1000;

	const rawIdle = Number(process.env.AIRA_WORKER_IDLE_INTERVAL_MS ?? "2500");
	const idleIntervalMs = Number.isFinite(rawIdle) ? Math.max(500, Math.min(60000, Math.trunc(rawIdle))) : 2500;

	const workerId =
		process.env.AIRA_WORKER_ID?.trim() ||
		`worker:${os.hostname().replace(/[^a-zA-Z0-9_-]/g, "")}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

	const runOnce = ["1", "true", "yes"].includes((process.env.AIRA_WORKER_RUN_ONCE ?? "").trim().toLowerCase());

	return {
		workerId,
		concurrency,
		pollIntervalMs,
		idleIntervalMs,
		maxBackoffMs: 15000,
		runOnce,
	};
}

class WorkRuntimeWorker {
	private readonly config: WorkerConfig;
	private status: "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" = "STARTING";
	private readonly startedAt = new Date();
	private lastHeartbeatAt = new Date();
	private totalTicks = 0;
	private totalAttempted = 0;
	private totalAdvanced = 0;
	private totalFailures = 0;
	private consecutiveErrors = 0;
	private activeTickPromise: Promise<void> | null = null;
	private isShutdownRequested = false;
	private loopTimer: NodeJS.Timeout | null = null;

	constructor(config?: Partial<WorkerConfig>) {
		const base = resolveWorkerConfig();
		this.config = { ...base, ...config };
	}

	public getMetrics(): WorkerMetrics {
		return {
			workerId: this.config.workerId,
			status: this.status,
			uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
			startedAt: this.startedAt.toISOString(),
			lastHeartbeatAt: this.lastHeartbeatAt.toISOString(),
			totalTicks: this.totalTicks,
			totalAttempted: this.totalAttempted,
			totalAdvanced: this.totalAdvanced,
			totalFailures: this.totalFailures,
			consecutiveErrors: this.consecutiveErrors,
		};
	}

	private log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
		const entry = {
			timestamp: new Date().toISOString(),
			workerId: this.config.workerId,
			level,
			message,
			...meta,
		};
		if (level === "error") {
			console.error(JSON.stringify(entry));
		} else if (level === "warn") {
			console.warn(JSON.stringify(entry));
		} else {
			console.log(JSON.stringify(entry));
		}
	}

	public async tick(): Promise<{ attempted: number; advanced: number; failures: number }> {
		this.totalTicks += 1;
		this.lastHeartbeatAt = new Date();

		try {
			// 1. Recover any expired task or run claims globally
			await recoverExpiredClaims().catch((err) => {
				this.log("warn", "Periodic claim recovery encountered transient error", {
					error: err instanceof Error ? err.message : String(err),
				});
				return 0;
			});

			// 2. Advance schedulable runs via FOR UPDATE SKIP LOCKED
			const result = await advanceScheduledRuns(this.config.concurrency);
			this.totalAttempted += result.attempted;
			this.totalAdvanced += result.advanced;
			this.totalFailures += result.failures.length;
			this.consecutiveErrors = 0;

			if (result.attempted > 0) {
				this.log("info", "Advanced scheduled runs", {
					attempted: result.attempted,
					advanced: result.advanced,
					failureCount: result.failures.length,
				});
			}

			return {
				attempted: result.attempted,
				advanced: result.advanced,
				failures: result.failures.length,
			};
		} catch (error) {
			this.consecutiveErrors += 1;
			this.totalFailures += 1;
			this.log("error", "Worker tick encountered an error", {
				error: error instanceof Error ? error.message : String(error),
				consecutiveErrors: this.consecutiveErrors,
			});
			return { attempted: 0, advanced: 0, failures: 1 };
		}
	}

	public async start(): Promise<void> {
		this.status = "RUNNING";
		this.log("info", "AIRA Work Runtime Worker starting", {
			workerId: this.config.workerId,
			concurrency: this.config.concurrency,
			pollIntervalMs: this.config.pollIntervalMs,
			idleIntervalMs: this.config.idleIntervalMs,
			runOnce: this.config.runOnce,
		});

		if (this.config.runOnce) {
			await this.tick();
			this.status = "STOPPED";
			this.log("info", "Single-tick execution complete, exiting", this.getMetrics() as unknown as Record<string, unknown>);
			return;
		}

		const runLoop = async () => {
			if (this.isShutdownRequested) {
				this.status = "STOPPED";
				return;
			}

			const tickPromise = this.tick();
			this.activeTickPromise = tickPromise.then(() => undefined);
			const { attempted } = await tickPromise;
			this.activeTickPromise = null;

			if (this.isShutdownRequested) {
				this.status = "STOPPED";
				return;
			}

			let nextDelayMs: number;
			if (this.consecutiveErrors > 0) {
				nextDelayMs = Math.min(this.config.maxBackoffMs, 1000 * Math.pow(2, this.consecutiveErrors));
			} else if (attempted > 0) {
				nextDelayMs = this.config.pollIntervalMs;
			} else {
				nextDelayMs = this.config.idleIntervalMs;
			}

			this.loopTimer = setTimeout(runLoop, nextDelayMs);
		};

		await runLoop();
	}

	public async shutdown(): Promise<void> {
		if (this.isShutdownRequested) return;
		this.isShutdownRequested = true;
		this.status = "STOPPING";
		this.log("info", "Worker shutdown initiated, finishing active in-flight tick...", {
			workerId: this.config.workerId,
		});

		if (this.loopTimer) {
			clearTimeout(this.loopTimer);
			this.loopTimer = null;
		}

		if (this.activeTickPromise) {
			try {
				await Promise.race([
					this.activeTickPromise,
					new Promise((resolve) => setTimeout(resolve, 10000)),
				]);
			} catch {
				// Ignore errors during graceful shutdown wait
			}
		}

		this.status = "STOPPED";
		this.log("info", "Worker stopped cleanly", this.getMetrics() as unknown as Record<string, unknown>);
	}
}

export { WorkRuntimeWorker };

// Standalone execution detection
const isMain = process.argv[1] && (process.argv[1].endsWith("worker.ts") || process.argv[1].endsWith("worker.js"));

if (isMain) {
	const worker = new WorkRuntimeWorker();

	const handleSignal = async (signal: string) => {
		console.log(`\nReceived ${signal}, commencing graceful shutdown...`);
		await worker.shutdown();
		process.exit(0);
	};

	process.on("SIGINT", () => handleSignal("SIGINT"));
	process.on("SIGTERM", () => handleSignal("SIGTERM"));

	worker.start().catch((err) => {
		console.error("Worker fatal error:", err);
		process.exit(1);
	});
}

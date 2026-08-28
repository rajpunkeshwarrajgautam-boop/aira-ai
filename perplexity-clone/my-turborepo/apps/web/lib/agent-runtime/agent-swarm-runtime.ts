import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import { classifyStaleRun } from "@/lib/agents/run-reconciliation";
import type { AgentRunDto } from "@/lib/autogpt/runs";
import { toAgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

import type {
	AgentRuntime,
	AgentRuntimeCapabilities,
	AgentRuntimeHealth,
	AgentRunSubmission,
	CreateAgentRunInput,
} from "./types";
import { AgentRuntimeError } from "./types";

const PROVIDER = "AGENT_SWARM";
const GRAPH_ID = "agent-swarm:lead-task";
const GRAPH_VERSION = 1;
const ACTIVE_SYNC_INTERVAL_MS = 2_500;
const DEFAULT_TIMEOUT_MS = 8_000;

const MODEL_TIER = z.enum(["smol", "regular", "smart", "ultra"]);
const SWARM_STATUS = z.enum([
	"backlog",
	"unassigned",
	"offered",
	"reviewing",
	"pending",
	"in_progress",
	"paused",
	"completed",
	"failed",
	"cancelled",
	"superseded",
]);

const SwarmTaskSchema = z.object({
	id: z.string().min(1),
	status: SWARM_STATUS,
	output: z.string().optional(),
	failureReason: z.string().optional(),
	progress: z.string().optional(),
	totalCostUsd: z.number().optional(),
});

type SwarmTask = z.infer<typeof SwarmTaskSchema>;

type AgentSwarmConfig = {
	readonly baseUrl: string;
	readonly apiToken: string;
	readonly timeoutMs: number;
	readonly modelTier?: z.infer<typeof MODEL_TIER>;
};

const RUN_SELECT = {
	id: true,
	provider: true,
	objective: true,
	status: true,
	result: true,
	errorMessage: true,
	createdAt: true,
	updatedAt: true,
	completedAt: true,
} satisfies Prisma.AgentRunSelect;

type SelectedRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

const CAPABILITIES: AgentRuntimeCapabilities = {
	cancel: true,
	pause: true,
	resume: true,
	steer: true,
	taskGraph: true,
	spawnAgent: true,
	events: true,
	artifacts: true,
};

export function isAgentSwarmEnabled(): boolean {
	return ["1", "true", "yes", "on"].includes(
		(process.env.AGENT_SWARM_ENABLED ?? "").trim().toLowerCase(),
	);
}

function normalizeBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_CONFIG_INVALID",
			message: "AGENT_SWARM_BASE_URL must be a valid URL.",
			status: 503,
			runtimeId: "AGENT_SWARM",
		});
	}
	if (url.username || url.password) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_CONFIG_INVALID",
			message: "Agent Swarm credentials must not be embedded in its URL.",
			status: 503,
			runtimeId: "AGENT_SWARM",
		});
	}
	const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_INSECURE_URL",
			message: "Agent Swarm requires HTTPS outside loopback in production.",
			status: 503,
			runtimeId: "AGENT_SWARM",
		});
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_CONFIG_INVALID",
			message: "Agent Swarm must use HTTP or HTTPS.",
			status: 503,
			runtimeId: "AGENT_SWARM",
		});
	}
	return url.toString().replace(/\/$/, "");
}

export function getAgentSwarmConfig(): AgentSwarmConfig {
	const rawUrl = process.env.AGENT_SWARM_BASE_URL?.trim();
	const apiToken = process.env.AGENT_SWARM_API_TOKEN?.trim();
	if (!rawUrl || !apiToken) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_NOT_CONFIGURED",
			message: "Agent Swarm requires AGENT_SWARM_BASE_URL and AGENT_SWARM_API_TOKEN.",
			status: 503,
			runtimeId: "AGENT_SWARM",
		});
	}
	const parsedTimeout = Number(process.env.AGENT_SWARM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
	const timeoutMs = Number.isFinite(parsedTimeout)
		? Math.min(60_000, Math.max(1_000, Math.trunc(parsedTimeout)))
		: DEFAULT_TIMEOUT_MS;
	const parsedTier = MODEL_TIER.safeParse(process.env.AGENT_SWARM_MODEL_TIER?.trim().toLowerCase());
	return {
		baseUrl: normalizeBaseUrl(rawUrl),
		apiToken,
		timeoutMs,
		...(parsedTier.success ? { modelTier: parsedTier.data } : {}),
	};
}

export function isAgentSwarmConfigured(): boolean {
	try {
		getAgentSwarmConfig();
		return true;
	} catch {
		return false;
	}
}

async function swarmRequest<T>(
	config: AgentSwarmConfig,
	path: string,
	options: { readonly method?: string; readonly body?: unknown; readonly submission?: boolean } = {},
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	let response: Response;
	try {
		response = await fetch(`${config.baseUrl}${path}`, {
			method: options.method ?? "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${config.apiToken}`,
				...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: controller.signal,
			cache: "no-store",
		});
	} catch {
		throw new AgentRuntimeError({
			code: options.submission ? "AGENT_SWARM_SUBMISSION_UNKNOWN" : "AGENT_SWARM_UNREACHABLE",
			message: options.submission
				? "Agent Swarm did not confirm whether it accepted this task."
				: "Agent Swarm is temporarily unreachable.",
			status: 503,
			runtimeId: "AGENT_SWARM",
			retryable: !options.submission,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_REQUEST_FAILED",
			message: `Agent Swarm returned HTTP ${response.status}.`,
			status: response.status >= 400 && response.status < 600 ? response.status : 502,
			runtimeId: "AGENT_SWARM",
			retryable,
		});
	}
	return (await response.json()) as T;
}

async function getSwarmTask(config: AgentSwarmConfig, taskId: string): Promise<SwarmTask> {
	const raw = await swarmRequest<unknown>(config, `/api/tasks/${encodeURIComponent(taskId)}`);
	const parsed = SwarmTaskSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_RESPONSE_INVALID",
			message: "Agent Swarm returned an invalid task response.",
			status: 502,
			runtimeId: "AGENT_SWARM",
			retryable: true,
		});
	}
	return parsed.data;
}

async function createSwarmTask(
	config: AgentSwarmConfig,
	input: CreateAgentRunInput,
): Promise<SwarmTask> {
	const raw = await swarmRequest<unknown>(config, "/api/tasks", {
		method: "POST",
		submission: true,
		body: {
			task: input.objective,
			source: "api",
			requestedByUserId: input.userId,
			priority: 50,
			...(config.modelTier ? { modelTier: config.modelTier } : {}),
		},
	});
	const parsed = SwarmTaskSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_RESPONSE_INVALID",
			message: "Agent Swarm accepted the request but returned an invalid task response.",
			status: 502,
			runtimeId: "AGENT_SWARM",
		});
	}
	return parsed.data;
}

function statusFromSwarm(status: SwarmTask["status"]): AgentRunStatus {
	switch (status) {
		case "completed":
			return AgentRunStatus.COMPLETED;
		case "failed":
			return AgentRunStatus.FAILED;
		case "cancelled":
		case "superseded":
			return AgentRunStatus.TERMINATED;
		case "paused":
			return AgentRunStatus.REVIEW;
		case "in_progress":
			return AgentRunStatus.RUNNING;
		default:
			return AgentRunStatus.QUEUED;
	}
}

function isTerminal(status: AgentRunStatus): boolean {
	return [AgentRunStatus.COMPLETED, AgentRunStatus.FAILED, AgentRunStatus.TERMINATED].includes(status);
}

async function persistTaskState(row: SelectedRun, task: SwarmTask): Promise<AgentRunDto> {
	const status = statusFromSwarm(task.status);
	const terminal = isTerminal(status);
	const result: Prisma.InputJsonValue | undefined = status === AgentRunStatus.COMPLETED
		? {
			taskId: task.id,
			output: task.output ?? null,
			progress: task.progress ?? null,
			totalCostUsd: task.totalCostUsd ?? null,
		}
		: undefined;
	const updated = await prisma.agentRun.update({
		where: { id: row.id },
		data: {
			status,
			...(result !== undefined ? { result } : {}),
			...(status === AgentRunStatus.FAILED
				? { errorMessage: task.failureReason ?? "Agent Swarm reported that this task failed." }
				: {}),
			completedAt: terminal ? row.completedAt ?? new Date() : null,
		},
		select: RUN_SELECT,
	});
	return toAgentRunDto(updated);
}

async function submitAgentSwarmRun(input: CreateAgentRunInput): Promise<AgentRunSubmission> {
	const config = getAgentSwarmConfig();
	const existing = await prisma.agentRun.findUnique({
		where: { userId_clientRequestId: { userId: input.userId, clientRequestId: input.clientRequestId } },
		select: RUN_SELECT,
	});
	if (existing) {
		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(existing), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let pending: SelectedRun;
	try {
		pending = await prisma.agentRun.create({
			data: {
				userId: input.userId,
				clientRequestId: input.clientRequestId,
				provider: PROVIDER,
				graphId: GRAPH_ID,
				graphVersion: GRAPH_VERSION,
				objective: input.objective,
			},
			select: RUN_SELECT,
		});
	} catch (error) {
		const concurrent = await prisma.agentRun.findUnique({
			where: { userId_clientRequestId: { userId: input.userId, clientRequestId: input.clientRequestId } },
			select: RUN_SELECT,
		});
		if (!concurrent) throw error;
		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(concurrent), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	let remaining: number;
	try {
		remaining = (await consumeAgentRunQuota(input.userId)).agentRunsRemaining;
	} catch (error) {
		await prisma.agentRun.delete({ where: { id: pending.id } }).catch(() => undefined);
		throw error;
	}

	try {
		const task = await createSwarmTask(config, input);
		const submitted = await prisma.agentRun.update({
			where: { id: pending.id },
			data: { remoteExecutionId: task.id, status: statusFromSwarm(task.status) },
			select: RUN_SELECT,
		});
		return { run: toAgentRunDto(submitted), agentRunsRemaining: remaining };
	} catch (error) {
		const outcomeUnknown = error instanceof AgentRuntimeError && error.code === "AGENT_SWARM_SUBMISSION_UNKNOWN";
		await Promise.allSettled([
			prisma.agentRun.update({
				where: { id: pending.id },
				data: {
					status: AgentRunStatus.FAILED,
					errorMessage: outcomeUnknown
						? "Agent Swarm did not confirm whether it accepted this task. AIRA did not retry to avoid duplicate autonomous work."
						: "Agent Swarm could not accept this task.",
					completedAt: new Date(),
				},
			}),
			...(outcomeUnknown ? [] : [refundAgentRunQuota(input.userId)]),
		]);
		throw error;
	}
}

async function refreshAgentSwarmRun(userId: string, runId: string): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({ where: { id: runId, userId, provider: PROVIDER } });
	if (!row) return null;
	if (isTerminal(row.status)) return toAgentRunDto(row);
	const stale = classifyStaleRun({ remoteExecutionId: row.remoteExecutionId, createdAt: row.createdAt });
	if (stale) {
		const closed = await prisma.agentRun.update({
			where: { id: row.id },
			data: { status: AgentRunStatus.FAILED, errorMessage: stale.errorMessage, completedAt: new Date() },
			select: RUN_SELECT,
		});
		return toAgentRunDto(closed);
	}
	if (!row.remoteExecutionId || Date.now() - row.updatedAt.getTime() < ACTIVE_SYNC_INTERVAL_MS) {
		return toAgentRunDto(row);
	}
	return persistTaskState(row, await getSwarmTask(getAgentSwarmConfig(), row.remoteExecutionId));
}

async function taskAction(
	userId: string,
	runId: string,
	action: "cancel" | "pause" | "resume",
): Promise<AgentRunDto | null> {
	const row = await prisma.agentRun.findFirst({ where: { id: runId, userId, provider: PROVIDER } });
	if (!row) return null;
	if (!row.remoteExecutionId || isTerminal(row.status)) return toAgentRunDto(row);
	const raw = await swarmRequest<unknown>(
		getAgentSwarmConfig(),
		`/api/tasks/${encodeURIComponent(row.remoteExecutionId)}/${action}`,
		{ method: "POST" },
	);
	const parsed = z.object({ task: SwarmTaskSchema }).safeParse(raw);
	if (!parsed.success) {
		throw new AgentRuntimeError({
			code: "AGENT_SWARM_RESPONSE_INVALID",
			message: `Agent Swarm returned an invalid ${action} response.`,
			status: 502,
			runtimeId: "AGENT_SWARM",
		});
	}
	return persistTaskState(row, parsed.data.task);
}

async function steerAgentSwarm(userId: string, runId: string, instruction: string): Promise<void> {
	const row = await prisma.agentRun.findFirst({ where: { id: runId, userId, provider: PROVIDER } });
	if (!row?.remoteExecutionId) {
		throw new AgentRuntimeError({
			code: "AGENT_RUN_NOT_FOUND",
			message: "Agent task not found.",
			status: 404,
			runtimeId: "AGENT_SWARM",
		});
	}
	await swarmRequest<unknown>(
		getAgentSwarmConfig(),
		`/api/tasks/${encodeURIComponent(row.remoteExecutionId)}/steer`,
		{
			method: "POST",
			body: {
				message: instruction,
				mode: "queue",
				source: "api",
				onUnsupported: "degrade",
				requestedByUserId: userId,
			},
		},
	);
}

export const agentSwarmRuntime: AgentRuntime = {
	id: "AGENT_SWARM",
	capabilities: CAPABILITIES,
	isEnabled: isAgentSwarmEnabled,
	isConfigured: isAgentSwarmConfigured,
	async getHealth(): Promise<AgentRuntimeHealth> {
		const enabled = isAgentSwarmEnabled();
		const configured = isAgentSwarmConfigured();
		if (!enabled || !configured) {
			return {
				id: "AGENT_SWARM",
				enabled,
				configured,
				healthy: false,
				ready: false,
				capabilities: CAPABILITIES,
			};
		}
		let healthy = false;
		try {
			await swarmRequest<unknown>(getAgentSwarmConfig(), "/api/tasks?limit=1");
			healthy = true;
		} catch {
			healthy = false;
		}
		return {
			id: "AGENT_SWARM",
			enabled,
			configured,
			healthy,
			ready: enabled && configured && healthy,
			capabilities: CAPABILITIES,
		};
	},
	createRun: submitAgentSwarmRun,
	refreshRun: refreshAgentSwarmRun,
	cancelRun: (userId, runId) => taskAction(userId, runId, "cancel"),
	pauseRun: (userId, runId) => taskAction(userId, runId, "pause"),
	resumeRun: (userId, runId) => taskAction(userId, runId, "resume"),
	steerAgent: steerAgentSwarm,
};
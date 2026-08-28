import { AgentRunStatus } from "@/generated/prisma/enums";
import { getAgentRuntime, selectAgentRuntime } from "@/lib/agent-runtime/registry";
import type { AgentRuntimeId } from "@/lib/agent-runtime/types";
import { prisma } from "@/lib/prisma";

import {
	appendEvent,
	claimTask,
	completeTask,
	createAgentInstance,
	createPlatformRun,
	failTask,
	getRunForUser,
	listPendingApprovals,
	listTasks,
	markTaskRunning,
	setRunStatus,
	setTaskStatus,
} from "./store";
import {
	DEFAULT_RUN_BUDGETS,
	type PlatformRun,
	type PlatformTask,
	type RunBudgets,
	type RuntimeTickResult,
	type TaskSpec,
} from "./types";

const AGENT_TOOLS: Record<string, readonly string[]> = {
	PRODUCT: ["files", "web", "memory"],
	RESEARCH: ["web", "browser", "files"],
	ARCHITECT: ["files", "git", "memory"],
	UI_UX: ["files", "browser", "image"],
	FRONTEND: ["files", "git", "terminal", "browser"],
	BACKEND: ["files", "git", "terminal"],
	DATABASE: ["files", "git", "terminal", "supabase"],
	SECURITY: ["files", "git", "terminal", "browser"],
	INTEGRATOR: ["files", "git", "terminal"],
	QA: ["terminal", "browser", "files"],
	BROWSER: ["browser", "files"],
	DEVOPS: ["git", "terminal", "vercel", "github"],
	VERIFICATION: ["browser", "terminal", "vercel", "github"],
};

function boundedBudgets(input?: Partial<RunBudgets>): RunBudgets {
	return {
		maxAgents: Math.max(1, Math.min(16, input?.maxAgents ?? DEFAULT_RUN_BUDGETS.maxAgents)),
		maxParallelAgents: Math.max(1, Math.min(6, input?.maxParallelAgents ?? DEFAULT_RUN_BUDGETS.maxParallelAgents)),
		maxToolCalls: Math.max(10, Math.min(500, input?.maxToolCalls ?? DEFAULT_RUN_BUDGETS.maxToolCalls)),
		maxTokens: Math.max(10_000, Math.min(2_000_000, input?.maxTokens ?? DEFAULT_RUN_BUDGETS.maxTokens)),
		maxCostUsd: Math.max(0, Math.min(250, input?.maxCostUsd ?? DEFAULT_RUN_BUDGETS.maxCostUsd)),
		maxDurationMinutes: Math.max(10, Math.min(1440, input?.maxDurationMinutes ?? DEFAULT_RUN_BUDGETS.maxDurationMinutes)),
		maxRetries: Math.max(0, Math.min(5, input?.maxRetries ?? DEFAULT_RUN_BUDGETS.maxRetries)),
	};
}

function wantsDeployment(objective: string): boolean {
	return /\b(deploy|production|publish|ship|vercel|go live|live site)\b/i.test(objective);
}

export function buildManagerDag(objective: string): TaskSpec[] {
	const deploy = wantsDeployment(objective);
	const tasks: TaskSpec[] = [
		{
			key: "requirements",
			title: "Requirements and acceptance criteria",
			objective: `Turn the project objective into explicit functional requirements, constraints, acceptance criteria and proof-of-work requirements. Objective: ${objective}`,
			agentRole: "PRODUCT",
			modelTier: "reasoning",
			priority: 100,
			dependencies: [],
		},
		{
			key: "research",
			title: "Technical and product research",
			objective: `Research current implementation patterns, dependencies and risks that materially affect this objective. Return evidence and concrete decisions, not a generic essay. Objective: ${objective}`,
			agentRole: "RESEARCH",
			modelTier: "long-context",
			priority: 92,
			dependencies: [],
		},
		{
			key: "architecture",
			title: "Architecture and contracts",
			objective: "Inspect the repository and define the smallest safe architecture, module boundaries, API contracts, data changes and integration plan. Preserve working behavior.",
			agentRole: "ARCHITECT",
			modelTier: "reasoning",
			priority: 95,
			dependencies: ["requirements", "research"],
		},
		{
			key: "design",
			title: "Product and design system",
			objective: "Define the production UI/UX states, information hierarchy, responsive behavior and component contract. Reuse AIRA's design system and avoid placeholder UI.",
			agentRole: "UI_UX",
			modelTier: "vision",
			priority: 82,
			dependencies: ["requirements"],
		},
		{
			key: "database",
			title: "Database implementation",
			objective: "Implement additive database changes, constraints, authorization boundaries, indexes and safe migrations required by the architecture. Do not weaken existing data isolation.",
			agentRole: "DATABASE",
			modelTier: "coding",
			priority: 80,
			dependencies: ["architecture"],
		},
		{
			key: "backend",
			title: "Backend and runtime implementation",
			objective: "Implement server APIs, runtime orchestration and tool-policy behavior from the architecture. Keep auth, safety, billing and existing providers intact.",
			agentRole: "BACKEND",
			modelTier: "coding",
			priority: 78,
			dependencies: ["architecture"],
		},
		{
			key: "frontend",
			title: "Frontend implementation",
			objective: "Implement the real connected UI using existing AIRA components and backend contracts. All visible statuses/actions must correspond to backend state.",
			agentRole: "FRONTEND",
			modelTier: "coding",
			priority: 76,
			dependencies: ["architecture", "design"],
		},
		{
			key: "security",
			title: "Security review",
			objective: "Threat-model the implemented change for prompt injection, cross-user access, secret exposure, SSRF, command/tool escalation and compromised-worker behavior. Fix concrete defects found.",
			agentRole: "SECURITY",
			modelTier: "reasoning",
			priority: 72,
			dependencies: ["architecture", "backend", "database"],
		},
		{
			key: "integration",
			title: "Integration and proof-of-work",
			objective: "Integrate frontend, backend and database work; resolve contract mismatches; run typecheck/lint/unit tests/build; record changed files, commands and results.",
			agentRole: "INTEGRATOR",
			modelTier: "coding",
			priority: 68,
			dependencies: ["frontend", "backend", "database"],
		},
		{
			key: "qa",
			title: "Functional QA",
			objective: "Exercise primary workflows, error states, authorization boundaries and regression-sensitive existing features. Do not mark verified without executable evidence.",
			agentRole: "QA",
			modelTier: "balanced",
			priority: 60,
			dependencies: ["integration", "security"],
		},
		{
			key: "browser-qa",
			title: "Browser and responsive QA",
			objective: "Use a real browser where available. Test 360, 390, 768, 1024, 1280, 1440 and 1920 widths; inspect console/network failures, keyboard basics, clipping, overflow, modals and critical flows. Capture evidence.",
			agentRole: "BROWSER",
			modelTier: "vision",
			priority: 56,
			dependencies: ["qa"],
		},
	];

	if (deploy) {
		tasks.push({
			key: "deployment",
			title: "Production deployment",
			objective: "Deploy only the reviewed, tested revision using the project's existing deployment architecture. Record deployment identifier and URL. Do not alter unrelated production configuration.",
			agentRole: "DEVOPS",
			modelTier: "coding",
			priority: 45,
			dependencies: ["browser-qa"],
			approval: { action: "production deployment", risk: "HIGH" },
		});
	}

	tasks.push({
		key: "verification",
		title: "Final verification",
		objective: "Independently verify the final state and distinguish implemented, tested, deployed and production-verified. Report evidence and unresolved blockers only.",
		agentRole: "VERIFICATION",
		modelTier: "reasoning",
		priority: 40,
		dependencies: [deploy ? "deployment" : "browser-qa"],
	});
	return tasks;
}

export async function startManagedRun(input: {
	readonly userId: string;
	readonly projectId: string;
	readonly objective: string;
	readonly requestedRuntime?: AgentRuntimeId;
	readonly budgets?: Partial<RunBudgets>;
}): Promise<RuntimeTickResult> {
	const runtime = await selectAgentRuntime(input.requestedRuntime);
	const budgets = boundedBudgets(input.budgets);
	const tasks = buildManagerDag(input.objective).slice(0, budgets.maxAgents);
	const run = await createPlatformRun({
		userId: input.userId,
		projectId: input.projectId,
		runtime: runtime.id,
		budgets,
		tasks,
	});
	await appendEvent({ projectId: input.projectId, runId: run.id, type: "run.started", payload: { manager: "AIRA_MANAGER", runtime: runtime.id } });
	return tickManagedRun(input.userId, run.id);
}

function depsCompleted(task: PlatformTask, byId: Map<string, PlatformTask>): boolean {
	return task.dependencies.every((dependency) => byId.get(dependency)?.status === "COMPLETED");
}

function depsBroken(task: PlatformTask, byId: Map<string, PlatformTask>): boolean {
	return task.dependencies.some((dependency) => {
		const status = byId.get(dependency)?.status;
		return status === "FAILED" || status === "CANCELLED" || status === "BLOCKED";
	});
}

function artifactsFromResult(result: unknown): string[] {
	if (!result || typeof result !== "object" || Array.isArray(result)) return [];
	const artifacts = (result as Record<string, unknown>).artifacts;
	return Array.isArray(artifacts) ? artifacts.filter((value): value is string => typeof value === "string").slice(0, 50) : [];
}

async function reconcileActiveTasks(userId: string, run: PlatformRun, tasks: readonly PlatformTask[]): Promise<number> {
	let reconciled = 0;
	for (const task of tasks.filter((entry) => entry.status === "RUNNING" && entry.runtimeRunId)) {
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId!, userId }, select: { id: true, provider: true } });
		if (!local) {
			const next = await failTask(task, "The delegated runtime run no longer exists.");
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: next === "FAILED" ? "task.failed" : "task.requeued", payload: { reason: "runtime_run_missing" } });
			reconciled += 1;
			continue;
		}
		const runtime = getAgentRuntime(local.provider);
		const child = await runtime.refreshRun(userId, local.id);
		if (!child) continue;
		if (child.status === AgentRunStatus.COMPLETED) {
			const artifacts = runtime.getArtifacts ? await runtime.getArtifacts(userId, child.id).catch(() => []) : [];
			const paths = artifacts.length ? artifacts.map((artifact) => artifact.uri ?? artifact.name) : artifactsFromResult(child.result);
			await completeTask(task.id, paths);
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: "task.completed", payload: { runtimeRunId: child.id, artifacts: paths } });
			reconciled += 1;
		} else if (child.status === AgentRunStatus.FAILED || child.status === AgentRunStatus.TERMINATED) {
			const next = await failTask(task, child.errorMessage ?? `Delegated run ended with ${child.status}.`);
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: next === "FAILED" ? "task.failed" : "task.requeued", payload: { runtimeRunId: child.id, status: child.status } });
			reconciled += 1;
		} else if (child.status === AgentRunStatus.REVIEW) {
			await setTaskStatus(task.id, "WAITING");
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: "task.blocked", payload: { reason: "runtime_review" } });
			reconciled += 1;
		}
	}
	return reconciled;
}

async function dispatchReadyTasks(userId: string, run: PlatformRun, tasks: readonly PlatformTask[]): Promise<number> {
	const active = tasks.filter((task) => task.status === "RUNNING" || task.status === "CLAIMED").length;
	const capacity = Math.max(0, run.budgets.maxParallelAgents - active);
	if (!capacity) return 0;
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const candidates = tasks
		.filter((task) => (task.status === "QUEUED" || task.status === "READY") && depsCompleted(task, byId))
		.sort((a, b) => b.priority - a.priority)
		.slice(0, capacity);
	let dispatched = 0;
	const runtime = getAgentRuntime(run.runtime ?? "");
	for (const task of candidates) {
		const workerId = `aira:${run.id}:${crypto.randomUUID()}`;
		const claimed = await claimTask(task.id, workerId);
		if (!claimed) continue;
		const agentId = await createAgentInstance({
			projectId: run.projectId,
			runId: run.id,
			taskId: task.id,
			role: task.agentRole,
			objective: task.objective,
			modelTier: task.modelTier,
			allowedTools: AGENT_TOOLS[task.agentRole] ?? ["files"],
		});
		await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, agentId, type: "agent.spawned", payload: { role: task.agentRole, modelTier: task.modelTier } });
		try {
			const submission = await runtime.createRun({
				userId,
				clientRequestId: task.id,
				objective: [
					`You are AIRA's ${task.agentRole} specialist inside managed run ${run.id}.`,
					`Task: ${task.title}`,
					task.objective,
					"Work only on this delegated task. Return concrete artifacts/evidence and concise handoff information to the Manager.",
				].join("\n\n"),
			});
			await markTaskRunning(task.id, submission.run.id, agentId);
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, agentId, type: "task.started", payload: { runtime: runtime.id, runtimeRunId: submission.run.id } });
			dispatched += 1;
		} catch (error) {
			const next = await failTask(claimed, error instanceof Error ? error.message : "Task dispatch failed.");
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, agentId, type: next === "FAILED" ? "task.failed" : "task.requeued", payload: { phase: "dispatch" } });
		}
	}
	return dispatched;
}

async function updateRunState(userId: string, run: PlatformRun, tasks: readonly PlatformTask[]): Promise<void> {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	for (const task of tasks) {
		if ((task.status === "QUEUED" || task.status === "READY") && depsBroken(task, byId)) {
			await setTaskStatus(task.id, "BLOCKED");
		}
	}
	const refreshed = await listTasks(run.id);
	const approvals = await listPendingApprovals(userId, run.id);
	if (refreshed.every((task) => task.status === "COMPLETED")) {
		await setRunStatus(run.id, "COMPLETED", "All planned work completed. Verify evidence before treating this as production-verified.");
		await appendEvent({ projectId: run.projectId, runId: run.id, type: "run.completed" });
		return;
	}
	if (refreshed.some((task) => task.status === "FAILED")) {
		await setRunStatus(run.id, "FAILED");
		await appendEvent({ projectId: run.projectId, runId: run.id, type: "run.failed" });
		return;
	}
	if (approvals.length > 0 && !refreshed.some((task) => task.status === "RUNNING" || task.status === "CLAIMED")) {
		await setRunStatus(run.id, "APPROVAL_REQUIRED");
		return;
	}
	if (refreshed.some((task) => task.status === "BLOCKED") && !refreshed.some((task) => task.status === "RUNNING")) {
		await setRunStatus(run.id, "BLOCKED");
		return;
	}
	await setRunStatus(run.id, "RUNNING");
}

export async function tickManagedRun(userId: string, runId: string): Promise<RuntimeTickResult> {
	let run = await getRunForUser(userId, runId);
	if (!run) throw new Error("Managed run not found.");
	if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
		return { run, tasks: await listTasks(run.id), dispatched: 0, reconciled: 0 };
	}
	let tasks = await listTasks(run.id);
	const reconciled = await reconcileActiveTasks(userId, run, tasks);
	tasks = await listTasks(run.id);
	const dispatched = await dispatchReadyTasks(userId, run, tasks);
	tasks = await listTasks(run.id);
	await updateRunState(userId, run, tasks);
	run = (await getRunForUser(userId, runId))!;
	return { run, tasks: await listTasks(run.id), dispatched, reconciled };
}

export async function steerManagedTask(input: { readonly userId: string; readonly runId: string; readonly taskId: string; readonly instruction: string }): Promise<void> {
	const run = await getRunForUser(input.userId, input.runId);
	if (!run) throw new Error("Managed run not found.");
	const task = (await listTasks(run.id)).find((entry) => entry.id === input.taskId);
	if (!task?.runtimeRunId) throw new Error("This task has no active delegated run.");
	const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId, userId: input.userId }, select: { provider: true } });
	if (!local) throw new Error("Delegated runtime run not found.");
	const runtime = getAgentRuntime(local.provider);
	if (!runtime.steerAgent) throw new Error(`${runtime.id} does not support mid-run steering.`);
	await runtime.steerAgent(input.userId, task.runtimeRunId, input.instruction);
	await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: "agent.message", payload: { kind: "STEERING", instruction: input.instruction } });
}

export async function cancelManagedRun(userId: string, runId: string): Promise<void> {
	const run = await getRunForUser(userId, runId);
	if (!run) throw new Error("Managed run not found.");
	const tasks = await listTasks(run.id);
	for (const task of tasks.filter((entry) => entry.runtimeRunId && (entry.status === "RUNNING" || entry.status === "WAITING" || entry.status === "CLAIMED"))) {
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId!, userId }, select: { provider: true } });
		if (local) {
			const runtime = getAgentRuntime(local.provider);
			if (runtime.cancelRun) await runtime.cancelRun(userId, task.runtimeRunId!).catch(() => null);
		}
		await setTaskStatus(task.id, "CANCELLED");
	}
	for (const task of tasks.filter((entry) => entry.status === "QUEUED" || entry.status === "READY" || entry.status === "APPROVAL_REQUIRED" || entry.status === "BLOCKED")) {
		await setTaskStatus(task.id, "CANCELLED");
	}
	await setRunStatus(run.id, "CANCELLED");
	await appendEvent({ projectId: run.projectId, runId: run.id, type: "run.cancelled" });
}

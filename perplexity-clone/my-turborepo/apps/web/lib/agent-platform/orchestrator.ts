import { AgentRunStatus } from "@/generated/prisma/enums";
import { buildRuntimeContext } from "@/lib/aira-runtime/context";
import { getAgentRuntime, selectAgentRuntime } from "@/lib/agent-runtime/registry";
import { AgentRuntimeError, type AgentRuntimeId } from "@/lib/agent-runtime/types";
import {
	consumeManagedMissionQuota,
	refundManagedMissionQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import { readMissionUsage } from "@/lib/tool-gateway/store";

import { recordAgentMessage } from "./messages";
import { rememberProjectFact, type ProjectMemoryKind } from "./project-memory";
import {
	appendEvent,
	claimTask,
	completeTask,
	createAgentInstance,
	createPlatformRun,
	failTask,
	getProjectForUser,
	getRunByClientRequestId,
	getRunForUser,
	listPendingApprovals,
	listTasks,
	markTaskRunning,
	recoverExpiredClaims,
	setRunStatus,
	setTaskStatus,
	TaskClaimLostError,
} from "./store";
import {
	DEFAULT_RUN_BUDGETS,
	type PlatformRun,
	type PlatformTask,
	type RunBudgets,
	type RuntimeTickResult,
	type TaskSpec,
} from "./types";
import { applyRuntimeUsage, missionBudgetExceeded, usageFromRuntimeResult } from "./usage";
import { getTaskWorktree, listRunWorktrees, type WorktreeRecord } from "./worktrees";

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

const CONTROLLED_WORKTREE_ROLES = new Set(["FRONTEND", "BACKEND", "DATABASE", "SECURITY", "INTEGRATOR"]);

/**
 * Runtime submissions are idempotent within one task attempt, but a definitive
 * failed attempt must not resolve back to the previous terminal AgentRun.
 * Keep the historical first-attempt key for crash recovery/backward
 * compatibility and use deterministic attempt-scoped keys for later attempts.
 */
export function runtimeAttemptRequestId(task: Pick<PlatformTask, "id" | "attempt">): string {
	const nextAttempt = Math.max(1, task.attempt + 1);
	return nextAttempt === 1 ? task.id : `${task.id}:attempt:${nextAttempt}`;
}

/**
 * Provider adapters use this flag when a submission may have reached a remote
 * runtime before the response became unknowable. It is intentionally checked
 * structurally so provider-specific request errors cannot accidentally be
 * treated as safe-to-retry merely because they do not extend AgentRuntimeError.
 */
export function runtimeSubmissionOutcomeUnknown(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"submissionOutcomeUnknown" in error &&
			(error as { readonly submissionOutcomeUnknown?: unknown }).submissionOutcomeUnknown === true,
	);
}

function boundedBudgets(input?: Partial<RunBudgets>): RunBudgets {
	return {
		maxAgents: Math.max(13, Math.min(24, input?.maxAgents ?? DEFAULT_RUN_BUDGETS.maxAgents)),
		maxParallelAgents: Math.max(1, Math.min(6, input?.maxParallelAgents ?? DEFAULT_RUN_BUDGETS.maxParallelAgents)),
		maxToolCalls: Math.max(10, Math.min(500, input?.maxToolCalls ?? DEFAULT_RUN_BUDGETS.maxToolCalls)),
		maxTokens: Math.max(10_000, Math.min(2_000_000, input?.maxTokens ?? DEFAULT_RUN_BUDGETS.maxTokens)),
		maxCostUsd: Math.max(0, Math.min(250, input?.maxCostUsd ?? DEFAULT_RUN_BUDGETS.maxCostUsd)),
		maxDurationMinutes: Math.max(10, Math.min(1440, input?.maxDurationMinutes ?? DEFAULT_RUN_BUDGETS.maxDurationMinutes)),
		maxRetries: Math.max(0, Math.min(5, input?.maxRetries ?? DEFAULT_RUN_BUDGETS.maxRetries)),
	};
}

function wantsDeployment(objective: string): boolean {
	const explicitNoDeploy = /\b(?:do not|don't|dont|never|without)\s+(?:a\s+)?(?:production\s+)?(?:deploy(?:ment|ing)?|publish(?:ing)?|ship(?:ping)?|go live)\b/i;
	const noDeployment = /\bno\s+(?:production\s+)?deployment\b/i;
	if (explicitNoDeploy.test(objective) || noDeployment.test(objective)) return false;
	return /\b(?:deploy(?:ment|ing)?|publish(?:ing)?|ship(?:ping)?|go live|live site|vercel(?:\s+deploy(?:ment|ing)?)?|production deployment)\b/i.test(objective);
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
	readonly clientRequestId: string;
	readonly objective: string;
	readonly requestedRuntime?: AgentRuntimeId;
	readonly budgets?: Partial<RunBudgets>;
}): Promise<RuntimeTickResult> {
	const existing = await getRunByClientRequestId(input.userId, input.clientRequestId);
	if (existing) return tickManagedRun(input.userId, existing.id);

	const runtime = await selectAgentRuntime(input.requestedRuntime);
	const budgets = boundedBudgets(input.budgets);
	const tasks = buildManagerDag(input.objective);
	if (tasks.length > budgets.maxAgents) {
		throw new AgentRuntimeError({
			code: "MISSION_AGENT_BUDGET_TOO_SMALL",
			message: `This mission requires ${tasks.length} specialist tasks but maxAgents is ${budgets.maxAgents}.`,
			status: 400,
			runtimeId: runtime.id,
		});
	}

	await consumeManagedMissionQuota(input.userId, input.clientRequestId);
	let run: PlatformRun;
	try {
		run = await createPlatformRun({
			userId: input.userId,
			projectId: input.projectId,
			clientRequestId: input.clientRequestId,
			objective: input.objective,
			runtime: runtime.id,
			budgets,
			tasks,
		});
	} catch (error) {
		const concurrent = await getRunByClientRequestId(input.userId, input.clientRequestId);
		if (concurrent) return tickManagedRun(input.userId, concurrent.id);
		await refundManagedMissionQuota(input.userId, input.clientRequestId).catch(() => undefined);
		throw error;
	}
	await Promise.all([
		appendEvent({
			projectId: input.projectId,
			runId: run.id,
			type: "run.started",
			payload: { manager: "AIRA_MANAGER", runtime: runtime.id, billing: "mission" },
		}),
		rememberProjectFact({
			userId: input.userId,
			projectId: input.projectId,
			memoryKey: "mission-goal",
			kind: "GOAL",
			content: input.objective,
			source: `managed-run:${run.id}`,
			importance: 5,
			confidence: 1,
		}).catch(() => undefined),
	]);
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

function safeHandoff(result: unknown): string {
	if (result === null || result === undefined) return "No structured runtime result was returned.";
	if (typeof result === "string") return result.slice(0, 6_000);
	try {
		return JSON.stringify(result, (key, value) =>
			/(password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)/i.test(key) ? "[redacted]" : value,
		).slice(0, 6_000);
	} catch {
		return "Runtime returned a non-serializable result.";
	}
}

function memoryKindForTask(task: PlatformTask): ProjectMemoryKind {
	if (task.agentRole === "VERIFICATION") return "VERIFICATION";
	if (task.agentRole === "ARCHITECT") return "ARCHITECTURE";
	if (task.agentRole === "DATABASE" || task.agentRole === "FRONTEND" || task.agentRole === "BACKEND") return "TECH_STACK";
	if (task.agentRole === "DEVOPS") return "DEPLOYMENT";
	return "DECISION";
}

function toolGatewayEnabled(): boolean {
	return ["1", "true", "yes", "on"].includes((process.env.AIRA_TOOL_GATEWAY_ENABLED ?? "").trim().toLowerCase());
}

function repositoryBinding(config: Record<string, unknown>): { repositoryUrl: string; baseRef: string } | null {
	const configuredUrl = typeof config.repositoryUrl === "string" ? config.repositoryUrl.trim() : "";
	const configuredBaseRef = typeof config.baseRef === "string" ? config.baseRef.trim() : "";
	const serverRepository = process.env.AIRA_GITHUB_REPOSITORY?.trim();
	const repositoryUrl = configuredUrl || (serverRepository ? `https://github.com/${serverRepository}.git` : "");
	if (!repositoryUrl) return null;
	try {
		const url = new URL(repositoryUrl);
		if (url.protocol !== "https:") return null;
	} catch {
		return null;
	}
	return {
		repositoryUrl,
		baseRef: configuredBaseRef || process.env.AIRA_GITHUB_BASE_BRANCH?.trim() || "main",
	};
}

async function consumeClaimedDispatchAttempt(task: PlatformTask): Promise<PlatformTask> {
	if (task.status !== "CLAIMED" || !task.leaseOwner) throw new TaskClaimLostError(task.id);
	const changed = await prisma.$executeRaw`
		update "AgentTask"
		set "attempt"="attempt"+1, "updatedAt"=current_timestamp
		where "id"=${task.id}
		  and "status"='CLAIMED'
		  and "leaseOwner"=${task.leaseOwner}
		  and "leaseExpiresAt" >= current_timestamp
	`;
	if (changed !== 1) throw new TaskClaimLostError(task.id);
	return { ...task, attempt: task.attempt + 1 };
}

async function blockClaimedTask(input: {
	readonly run: PlatformRun;
	readonly task: PlatformTask;
	readonly agentId: string;
	readonly reason: string;
	readonly reasonCode?: string;
	readonly risks?: readonly string[];
	readonly nextActions?: readonly string[];
	readonly runtimeRunId?: string | null;
	readonly consumeAttempt?: boolean;
}): Promise<void> {
	const reasonCode = input.reasonCode ?? "controlled_tooling_unavailable";
	await setTaskStatus(input.task.id, "BLOCKED");
	if (input.consumeAttempt || input.runtimeRunId) {
		await prisma.$executeRaw`
			update "AgentTask"
			set "attempt"=case when ${input.consumeAttempt ?? false} then least("maxAttempts", "attempt"+1) else "attempt" end,
				"runtimeRunId"=coalesce(${input.runtimeRunId ?? null}, "runtimeRunId"),
				"lastError"=${input.reason.slice(0, 4000)},
				"updatedAt"=current_timestamp
			where "id"=${input.task.id} and "status"='BLOCKED'
		`;
	}
	await Promise.all([
		prisma.$executeRaw`
			update "AgentInstance"
			set "status"='WAITING', "updatedAt"=current_timestamp
			where "id"=${input.agentId} and "currentTaskId"=${input.task.id}
		`,
		recordAgentMessage({
			projectId: input.run.projectId,
			runId: input.run.id,
			taskId: input.task.id,
			agentId: input.agentId,
			kind: "BLOCKER",
			body: {
				summary: input.reason,
				risks: [...(input.risks ?? [reasonCode])],
				nextActions: [...(input.nextActions ?? ["configure the required trusted runtime/tooling and resume the mission"])],
			},
		}).catch(() => undefined),
		appendEvent({
			projectId: input.run.projectId,
			runId: input.run.id,
			taskId: input.task.id,
			agentId: input.agentId,
			type: "task.blocked",
			payload: {
				reason: reasonCode,
				detail: input.reason.slice(0, 1000),
				...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
			},
		}),
	]);
}

async function blockRunningTaskForUnknownRuntimeOutcome(input: {
	readonly run: PlatformRun;
	readonly task: PlatformTask;
	readonly reasonCode: string;
	readonly detail: string;
}): Promise<boolean> {
	const changed = await prisma.$executeRaw`
		update "AgentTask"
		set "status"='BLOCKED', "lastError"=${input.detail.slice(0, 4000)}, "updatedAt"=current_timestamp
		where "id"=${input.task.id}
		  and "runId"=${input.run.id}
		  and "status"='RUNNING'
		  and "runtimeRunId" is not distinct from ${input.task.runtimeRunId}
	`;
	if (changed !== 1) return false;
	await Promise.all([
		prisma.$executeRaw`
			update "AgentInstance"
			set "status"='WAITING', "updatedAt"=current_timestamp
			where "currentTaskId"=${input.task.id} and "status" in ('WORKING','WAITING')
		`,
		recordAgentMessage({
			projectId: input.run.projectId,
			runId: input.run.id,
			taskId: input.task.id,
			kind: "BLOCKER",
			body: {
				summary: input.detail,
				risks: ["duplicate_execution"],
				nextActions: ["reconcile the previous runtime execution before authorizing any retry"],
			},
		}).catch(() => undefined),
		appendEvent({
			projectId: input.run.projectId,
			runId: input.run.id,
			taskId: input.task.id,
			type: "task.blocked",
			payload: {
				reason: input.reasonCode,
				detail: input.detail.slice(0, 1000),
				...(input.task.runtimeRunId ? { runtimeRunId: input.task.runtimeRunId } : {}),
			},
		}),
	]);
	return true;
}

async function prepareControlledWorkspace(input: {
	readonly userId: string;
	readonly run: PlatformRun;
	readonly task: PlatformTask;
	readonly agentId: string;
}): Promise<{ workspace: WorktreeRecord; relatedWorkspaces: readonly WorktreeRecord[] } | { blocked: string }> {
	const runtime = getAgentRuntime(input.run.runtime ?? "");
	if (!runtime.capabilities.controlledTools) {
		return { blocked: `${runtime.id} is not configured with the trusted AIRA runtime Tool Gateway bridge.` };
	}
	if (!toolGatewayEnabled()) {
		return { blocked: "AIRA Tool Gateway is disabled, so coding work cannot be delegated safely." };
	}
	const bridgeToken = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN?.trim();
	if (!bridgeToken || bridgeToken.length < 24) {
		return { blocked: "The dedicated runtime Tool Gateway credential is not configured." };
	}
	const project = await getProjectForUser(input.userId, input.run.projectId);
	if (!project) return { blocked: "The project no longer exists or is outside this user scope." };
	const binding = repositoryBinding(project.config);
	if (!binding) {
		return { blocked: "This project has no valid HTTPS repository binding. Configure project.repositoryUrl or the server-owned AIRA_GITHUB_REPOSITORY scope." };
	}

	let workspace = await getTaskWorktree(input.userId, input.task.id);
	if (!workspace || workspace.status === "FAILED" || workspace.status === "CLEANED") {
		const result = await executeTool(
			{
				userId: input.userId,
				projectId: input.run.projectId,
				runId: input.run.id,
				taskId: input.task.id,
				agentId: input.agentId,
				source: "SYSTEM",
			},
			{
				clientRequestId: `workspace:${input.task.id}`,
				tool: "git",
				action: "create_worktree",
				input: binding,
			},
		);
		if (result.status !== "COMPLETED") {
			return { blocked: `AIRA could not provision the controlled coding worktree (${result.status}).` };
		}
		workspace = await getTaskWorktree(input.userId, input.task.id);
	}
	if (!workspace || !["READY", "DIRTY", "CONFLICT", "INTEGRATED"].includes(workspace.status)) {
		return { blocked: "The isolated coding worktree is not ready." };
	}
	await prisma.$executeRaw`
		update "AgentInstance"
		set "workspace"=${workspace.workspaceId}, "updatedAt"=current_timestamp
		where "id"=${input.agentId} and "currentTaskId"=${input.task.id}
	`;
	const relatedWorkspaces = (await listRunWorktrees(input.userId, input.run.id)).filter((entry) => entry.workspaceId !== workspace!.workspaceId);
	return { workspace, relatedWorkspaces };
}

async function reconcileActiveTasks(userId: string, run: PlatformRun, tasks: readonly PlatformTask[]): Promise<number> {
	let reconciled = 0;
	for (const task of tasks.filter((entry) => entry.status === "RUNNING")) {
		if (!task.runtimeRunId) {
			if (await blockRunningTaskForUnknownRuntimeOutcome({
				run,
				task,
				reasonCode: "runtime_link_missing",
				detail: "The delegated task is running but its runtime execution link is missing. AIRA will not create another execution until the previous outcome is reconciled.",
			})) reconciled += 1;
			continue;
		}
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId, userId }, select: { id: true, provider: true } });
		if (!local) {
			if (await blockRunningTaskForUnknownRuntimeOutcome({
				run,
				task,
				reasonCode: "runtime_run_missing",
				detail: "The delegated runtime record no longer exists. Its remote outcome is unknown, so AIRA blocked the task instead of risking duplicate autonomous work.",
			})) reconciled += 1;
			continue;
		}
		const runtime = getAgentRuntime(local.provider);
		const child = await runtime.refreshRun(userId, local.id);
		if (!child) {
			if (await blockRunningTaskForUnknownRuntimeOutcome({
				run,
				task,
				reasonCode: "runtime_refresh_missing",
				detail: "The runtime could not resolve the delegated execution. AIRA blocked the task until the existing execution can be reconciled.",
			})) reconciled += 1;
			continue;
		}
		if (child.status === AgentRunStatus.COMPLETED) {
			const usage = usageFromRuntimeResult(child.result);
			await applyRuntimeUsage(run.id, usage).catch(() => undefined);
			const artifacts = runtime.getArtifacts ? await runtime.getArtifacts(userId, child.id).catch(() => []) : [];
			const paths = artifacts.length ? artifacts.map((artifact) => artifact.uri ?? artifact.name) : artifactsFromResult(child.result);
			const handoff = safeHandoff(child.result);
			await completeTask(task.id, paths);
			await Promise.all([
				recordAgentMessage({
					projectId: run.projectId,
					runId: run.id,
					taskId: task.id,
					kind: "RESULT",
					body: { summary: handoff, artifacts: paths, decisions: [], risks: [], nextActions: [] },
				}).catch(() => undefined),
				rememberProjectFact({
					userId,
					projectId: run.projectId,
					memoryKey: `task-${task.id}`,
					kind: memoryKindForTask(task),
					content: `${task.title}: ${handoff}`,
					source: `agent-run:${child.id}`,
					importance: task.agentRole === "VERIFICATION" || task.agentRole === "ARCHITECT" ? 5 : 3,
					metadata: { taskId: task.id, agentRole: task.agentRole, artifacts: paths.slice(0, 20) },
				}).catch(() => undefined),
				appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: "task.completed", payload: { runtimeRunId: child.id, artifacts: paths } }),
			]);
			reconciled += 1;
		} else if (child.status === AgentRunStatus.FAILED || child.status === AgentRunStatus.TERMINATED) {
			await applyRuntimeUsage(run.id, usageFromRuntimeResult(child.result)).catch(() => undefined);
			const next = await failTask(task, child.errorMessage ?? `Delegated run ended with ${child.status}.`);
			await recordAgentMessage({ projectId: run.projectId, runId: run.id, taskId: task.id, kind: "BLOCKER", body: { summary: child.errorMessage ?? `Delegated run ended with ${child.status}.`, risks: [child.status], nextActions: next === "FAILED" ? ["manager intervention required"] : ["retry task"] } }).catch(() => undefined);
			await appendEvent({
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				type: next === "FAILED" ? "task.failed" : "task.requeued",
				payload: {
					runtimeRunId: child.id,
					status: child.status,
					attempt: task.attempt,
					nextAttempt: next === "FAILED" ? null : task.attempt + 1,
				},
			});
			reconciled += 1;
		} else if (child.status === AgentRunStatus.REVIEW) {
			if (await blockRunningTaskForUnknownRuntimeOutcome({
				run,
				task,
				reasonCode: "runtime_review",
				detail: child.errorMessage ?? "The delegated runtime requires review before AIRA can safely continue this task.",
			})) reconciled += 1;
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
		const runtimeRequestId = runtimeAttemptRequestId(claimed);
		const allowedTools = AGENT_TOOLS[task.agentRole] ?? ["files"];
		const agentId = await createAgentInstance({
			projectId: run.projectId,
			runId: run.id,
			taskId: task.id,
			role: task.agentRole,
			objective: task.objective,
			modelTier: task.modelTier,
			allowedTools,
		});
		await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, agentId, type: "agent.spawned", payload: { role: task.agentRole, modelTier: task.modelTier } });
		try {
			let workspace: WorktreeRecord | undefined;
			let relatedWorkspaces: readonly WorktreeRecord[] = [];
			if (CONTROLLED_WORKTREE_ROLES.has(task.agentRole)) {
				const prepared = await prepareControlledWorkspace({ userId, run, task, agentId });
				if ("blocked" in prepared) {
					await blockClaimedTask({ run, task, agentId, reason: prepared.blocked });
					continue;
				}
				workspace = prepared.workspace;
				relatedWorkspaces = prepared.relatedWorkspaces;
			}

			const runtimeContext = await buildRuntimeContext({
				userId,
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				role: task.agentRole,
				taskTitle: task.title,
				objective: task.objective,
				allowedTools,
				...(workspace ? { workspace: { workspaceId: workspace.workspaceId, branch: workspace.branch, baseRef: workspace.baseRef } } : {}),
				...(relatedWorkspaces.length ? {
					relatedWorkspaces: relatedWorkspaces.map((entry) => ({
						workspaceId: entry.workspaceId,
						branch: entry.branch,
						taskId: entry.taskId,
						status: entry.status,
					})),
				} : {}),
			});
			await recordAgentMessage({
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				agentId,
				kind: "INSTRUCTION",
				body: {
					task: task.title,
					role: task.agentRole,
					selectedSkills: runtimeContext.selectedSkillIds,
					memoryKeys: runtimeContext.memoryKeys,
					attempt: claimed.attempt + 1,
					...(workspace ? { workspaceId: workspace.workspaceId, branch: workspace.branch } : {}),
				},
			}).catch(() => undefined);

			const beforeSubmission = await getRunForUser(userId, run.id);
			if (!beforeSubmission || beforeSubmission.status === "CANCELLED") {
				await setTaskStatus(task.id, "CANCELLED").catch(() => undefined);
				await appendEvent({
					projectId: run.projectId,
					runId: run.id,
					taskId: task.id,
					agentId,
					type: "task.cancelled",
					payload: { reason: "run_cancelled_before_runtime_submission", runtimeClientRequestId: runtimeRequestId },
				}).catch(() => undefined);
				continue;
			}

			const submission = await runtime.createRun({
				userId,
				clientRequestId: runtimeRequestId,
				objective: runtimeContext.systemPrompt,
				billingMode: "DELEGATED",
			});

			const afterSubmission = await getRunForUser(userId, run.id);
			if (!afterSubmission || afterSubmission.status === "CANCELLED") {
				if (runtime.cancelRun) await runtime.cancelRun(userId, submission.run.id).catch(() => null);
				await setTaskStatus(task.id, "CANCELLED").catch(() => undefined);
				await appendEvent({
					projectId: run.projectId,
					runId: run.id,
					taskId: task.id,
					agentId,
					type: "task.cancelled",
					payload: {
						reason: "run_cancelled_after_runtime_submission",
						runtimeRunId: submission.run.id,
						runtimeClientRequestId: runtimeRequestId,
					},
				}).catch(() => undefined);
				continue;
			}

			await markTaskRunning(task.id, submission.run.id, agentId);
			await appendEvent({
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				agentId,
				type: "task.started",
				payload: {
					runtime: runtime.id,
					runtimeRunId: submission.run.id,
					runtimeClientRequestId: runtimeRequestId,
					attempt: claimed.attempt + 1,
					...(workspace ? { workspaceId: workspace.workspaceId, branch: workspace.branch } : {}),
				},
			});
			dispatched += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Task dispatch failed.";
			const [attemptRun, taskRows, currentRun] = await Promise.all([
				prisma.agentRun.findUnique({
					where: { userId_clientRequestId: { userId, clientRequestId: runtimeRequestId } },
					select: { id: true, status: true },
				}).catch(() => null),
				prisma.$queryRaw<Array<{ status: string; runtimeRunId: string | null; leaseOwner: string | null }>>`
					select "status","runtimeRunId","leaseOwner"
					from "AgentTask"
					where "id"=${task.id} and "runId"=${run.id} and "projectId"=${run.projectId}
					limit 1
				`.catch(() => []),
				getRunForUser(userId, run.id).catch(() => null),
			]);
			const taskState = taskRows[0] ?? null;

			if (currentRun?.status === "CANCELLED" || taskState?.status === "CANCELLED") {
				if (
					attemptRun &&
					attemptRun.status !== AgentRunStatus.FAILED &&
					attemptRun.status !== AgentRunStatus.TERMINATED &&
					runtime.cancelRun
				) {
					await runtime.cancelRun(userId, attemptRun.id).catch(() => null);
				}
				await appendEvent({
					projectId: run.projectId,
					runId: run.id,
					taskId: task.id,
					agentId,
					type: "task.cancelled",
					payload: { reason: "run_cancelled_during_dispatch", runtimeRunId: attemptRun?.id ?? null, runtimeClientRequestId: runtimeRequestId },
				}).catch(() => undefined);
				continue;
			}

			// If markTaskRunning committed but its response was lost, the durable task
			// row is authoritative. Do not block or advance the attempt merely because
			// later bookkeeping observed an error.
			if (attemptRun && taskState?.status === "RUNNING" && taskState.runtimeRunId === attemptRun.id) {
				await appendEvent({
					projectId: run.projectId,
					runId: run.id,
					taskId: task.id,
					agentId,
					type: "task.recovered",
					payload: { reason: "runtime_link_already_committed", runtimeRunId: attemptRun.id, runtimeClientRequestId: runtimeRequestId },
				}).catch(() => undefined);
				dispatched += 1;
				continue;
			}

			const attemptOutcomeUncertain =
				runtimeSubmissionOutcomeUnknown(error) ||
				Boolean(
					attemptRun &&
					attemptRun.status !== AgentRunStatus.FAILED &&
					attemptRun.status !== AgentRunStatus.TERMINATED,
				);
			if (attemptOutcomeUncertain) {
				if (taskState?.status === "CLAIMED" && taskState.leaseOwner === claimed.leaseOwner) {
					await blockClaimedTask({
						run,
						task: claimed,
						agentId,
						reason: "A delegated runtime execution may already exist for this task attempt. AIRA preserved the same attempt identity and blocked automatic advancement until that execution is reconciled.",
						reasonCode: "runtime_outcome_unknown",
						risks: ["duplicate_execution"],
						nextActions: ["reconcile the existing runtime execution before authorizing any new attempt"],
						runtimeRunId: attemptRun?.id ?? null,
						consumeAttempt: false,
					});
				} else {
					// A task-claim recovery may already have moved this row back to QUEUED.
					// Keeping the attempt counter unchanged guarantees that redispatch uses
					// the same runtimeRequestId and therefore recovers idempotently instead
					// of starting a new remote execution.
					await appendEvent({
						projectId: run.projectId,
						runId: run.id,
						taskId: task.id,
						agentId,
						type: "task.recovery_pending",
						payload: {
							reason: "runtime_link_unconfirmed",
							runtimeRunId: attemptRun?.id ?? null,
							runtimeClientRequestId: runtimeRequestId,
						},
					}).catch(() => undefined);
				}
				continue;
			}

			const attempted = await consumeClaimedDispatchAttempt(claimed);
			const next = await failTask(attempted, message);
			await appendEvent({
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				agentId,
				type: next === "FAILED" ? "task.failed" : "task.requeued",
				payload: {
					phase: "dispatch",
					attempt: attempted.attempt,
					nextAttempt: next === "FAILED" ? null : attempted.attempt + 1,
					runtimeClientRequestId: runtimeRequestId,
				},
			});
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

async function haltForBudget(userId: string, run: PlatformRun, reason: string): Promise<void> {
	const tasks = await listTasks(run.id);
	for (const task of tasks.filter((entry) => entry.runtimeRunId && (entry.status === "RUNNING" || entry.status === "WAITING" || entry.status === "CLAIMED"))) {
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId!, userId }, select: { provider: true } });
		if (local) {
			const runtime = getAgentRuntime(local.provider);
			if (runtime.cancelRun) await runtime.cancelRun(userId, task.runtimeRunId!).catch(() => null);
		}
		await setTaskStatus(task.id, "BLOCKED");
	}
	for (const task of tasks.filter((entry) => entry.status === "QUEUED" || entry.status === "READY")) await setTaskStatus(task.id, "BLOCKED");
	await setRunStatus(run.id, "BLOCKED", reason);
	await appendEvent({ projectId: run.projectId, runId: run.id, type: "run.blocked", payload: { reason: "budget", detail: reason } });
}

async function enforceUsageBudget(userId: string, run: PlatformRun): Promise<boolean> {
	const usage = await readMissionUsage(run.id).catch(() => null);
	if (!usage) return false;
	const verdict = missionBudgetExceeded({ budgets: run.budgets, usage });
	if (!verdict.exceeded) return false;
	await haltForBudget(userId, run, verdict.reason);
	return true;
}

export async function tickManagedRun(userId: string, runId: string): Promise<RuntimeTickResult> {
	let run = await getRunForUser(userId, runId);
	if (!run) throw new Error("Managed run not found.");
	if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
		return { run, tasks: await listTasks(run.id), dispatched: 0, reconciled: 0 };
	}
	if (run.startedAt && Date.now() - run.startedAt.getTime() > run.budgets.maxDurationMinutes * 60_000) {
		await haltForBudget(userId, run, `Mission exceeded its ${run.budgets.maxDurationMinutes}-minute execution budget.`);
		run = (await getRunForUser(userId, run.id))!;
		return { run, tasks: await listTasks(run.id), dispatched: 0, reconciled: 0 };
	}
	if (await enforceUsageBudget(userId, run)) {
		run = (await getRunForUser(userId, run.id))!;
		return { run, tasks: await listTasks(run.id), dispatched: 0, reconciled: 0 };
	}
	await recoverExpiredClaims(run.id);
	let tasks = await listTasks(run.id);
	const reconciled = await reconcileActiveTasks(userId, run, tasks);
	if (await enforceUsageBudget(userId, run)) {
		run = (await getRunForUser(userId, run.id))!;
		return { run, tasks: await listTasks(run.id), dispatched: 0, reconciled };
	}
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
	await Promise.all([
		recordAgentMessage({ projectId: run.projectId, runId: run.id, taskId: task.id, kind: "STEERING", body: { instruction: input.instruction } }).catch(() => undefined),
		appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: "agent.message", payload: { kind: "STEERING", instruction: input.instruction } }),
	]);
}

export async function cancelManagedRun(userId: string, runId: string): Promise<void> {
	const run = await getRunForUser(userId, runId);
	if (!run) throw new Error("Managed run not found.");
	if (run.status === "CANCELLED") return;
	if (run.status === "COMPLETED" || run.status === "FAILED") return;

	// Fence the mission first. Tool Gateway budget reservation already refuses
	// terminal runs, so committing this state prevents any new privileged side
	// effect while best-effort remote cancellation and local cleanup continue.
	await setRunStatus(run.id, "CANCELLED");
	await prisma.$transaction([
		prisma.$executeRaw`
			update "AgentTask"
			set "status"='CANCELLED', "leaseOwner"=null, "leaseExpiresAt"=null, "updatedAt"=current_timestamp
			where "runId"=${run.id} and "status" not in ('COMPLETED','FAILED','CANCELLED')
		`,
		prisma.$executeRaw`
			update "AgentInstance"
			set "status"='STOPPED', "currentTaskId"=null, "updatedAt"=current_timestamp
			where "runId"=${run.id} and "status" not in ('COMPLETED','FAILED','STOPPED')
		`,
		prisma.$executeRaw`
			update "AgentToolCall"
			set "status"='CANCELLED', "completedAt"=current_timestamp
			where "runId"=${run.id} and "status" in ('PENDING','APPROVAL_REQUIRED')
		`,
		prisma.$executeRaw`
			update "AgentApproval"
			set "status"='REJECTED', "resolvedAt"=coalesce("resolvedAt", current_timestamp)
			where "runId"=${run.id} and "status"='PENDING'
		`,
	]);

	const cancelledTasks = await listTasks(run.id);
	for (const task of cancelledTasks.filter((entry) => entry.runtimeRunId)) {
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId!, userId }, select: { provider: true } });
		if (!local) continue;
		const runtime = getAgentRuntime(local.provider);
		if (runtime.cancelRun) await runtime.cancelRun(userId, task.runtimeRunId!).catch(() => null);
	}
	await appendEvent({ projectId: run.projectId, runId: run.id, type: "run.cancelled", payload: { sideEffectFence: "terminal_run" } });
}

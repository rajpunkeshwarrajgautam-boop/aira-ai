import { AgentRunStatus } from "@/generated/prisma/enums";
import { buildRuntimeContext } from "@/lib/aira-runtime/context";
import { getAgentRuntime, selectAgentRuntime } from "@/lib/agent-runtime/registry";
import { AgentRuntimeError, type AgentRuntimeId } from "@/lib/agent-runtime/types";
import {
	consumeAgentRunQuota,
	refundAgentRunQuota,
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

	await consumeAgentRunQuota(input.userId);
	let run: PlatformRun;
	try {
		run = await createPlatformRun({
			userId: input.userId,
			projectId: input.projectId,
			clientRequestId: input.clientRequestId,
			runtime: runtime.id,
			budgets,
			tasks,
		});
	} catch (error) {
		const concurrent = await getRunByClientRequestId(input.userId, input.clientRequestId);
		await refundAgentRunQuota(input.userId).catch(() => undefined);
		if (concurrent) return tickManagedRun(input.userId, concurrent.id);
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

async function blockClaimedTask(input: {
	readonly run: PlatformRun;
	readonly task: PlatformTask;
	readonly agentId: string;
	readonly reason: string;
}): Promise<void> {
	await Promise.all([
		setTaskStatus(input.task.id, "BLOCKED"),
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
			body: { summary: input.reason, risks: ["controlled_tooling_unavailable"], nextActions: ["configure the required trusted runtime/tooling and resume the mission"] },
		}).catch(() => undefined),
		appendEvent({
			projectId: input.run.projectId,
			runId: input.run.id,
			taskId: input.task.id,
			agentId: input.agentId,
			type: "task.blocked",
			payload: { reason: "controlled_tooling_unavailable", detail: input.reason.slice(0, 1000) },
		}),
	]);
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
	for (const task of tasks.filter((entry) => entry.status === "RUNNING" && entry.runtimeRunId)) {
		const local = await prisma.agentRun.findFirst({ where: { id: task.runtimeRunId!, userId }, select: { id: true, provider: true } });
		if (!local) {
			const next = await failTask(task, "The delegated runtime run no longer exists.");
			await recordAgentMessage({ projectId: run.projectId, runId: run.id, taskId: task.id, kind: "BLOCKER", body: { summary: "Delegated runtime run no longer exists.", nextActions: ["retry or reassign task"] } }).catch(() => undefined);
			await appendEvent({ projectId: run.projectId, runId: run.id, taskId: task.id, type: next === "FAILED" ? "task.failed" : "task.requeued", payload: { reason: "runtime_run_missing" } });
			reconciled += 1;
			continue;
		}
		const runtime = getAgentRuntime(local.provider);
		const child = await runtime.refreshRun(userId, local.id);
		if (!child) continue;
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
					...(workspace ? { workspaceId: workspace.workspaceId, branch: workspace.branch } : {}),
				},
			}).catch(() => undefined);
			const submission = await runtime.createRun({
				userId,
				clientRequestId: task.id,
				objective: runtimeContext.systemPrompt,
				billingMode: "DELEGATED",
			});
			await markTaskRunning(task.id, submission.run.id, agentId);
			await appendEvent({
				projectId: run.projectId,
				runId: run.id,
				taskId: task.id,
				agentId,
				type: "task.started",
				payload: { runtime: runtime.id, runtimeRunId: submission.run.id, ...(workspace ? { workspaceId: workspace.workspaceId, branch: workspace.branch } : {}) },
			});
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

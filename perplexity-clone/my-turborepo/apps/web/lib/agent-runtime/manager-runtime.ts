import { ExecutionMeter } from "./execution-meter";
import { planSchedulerTick } from "./scheduler";
import { reconcileTaskReadiness, validateTaskGraph } from "./task-graph";
import type {
	ExecutionBudget,
	RuntimeTask,
	SchedulerDecision,
	TaskGraph,
} from "./types";

export interface TaskExecutionContext {
	readonly objective: string;
	readonly task: RuntimeTask;
	readonly outputs: ReadonlyMap<string, RuntimeTaskExecutionResult>;
	readonly abortSignal?: AbortSignal;
}

export interface RuntimeTaskExecutionResult {
	readonly output: unknown;
	readonly evidence?: readonly string[];
	readonly artifacts?: readonly string[];
	readonly tokens?: number;
	readonly estimatedCostUsd?: number;
}

export interface RuntimeTaskExecutor {
	execute(context: TaskExecutionContext): Promise<RuntimeTaskExecutionResult>;
}

export interface ManagerRuntimeObserver {
	onSchedulerDecision?(decision: SchedulerDecision): void | Promise<void>;
	onTaskState?(task: RuntimeTask): void | Promise<void>;
	onTaskResult?(task: RuntimeTask, result: RuntimeTaskExecutionResult): void | Promise<void>;
	onTaskError?(task: RuntimeTask, error: unknown): void | Promise<void>;
}

export interface ManagerRuntimeInput {
	readonly objective: string;
	readonly graph: TaskGraph;
	readonly budget: ExecutionBudget;
	readonly executor: RuntimeTaskExecutor;
	readonly observer?: ManagerRuntimeObserver;
	readonly abortSignal?: AbortSignal;
	readonly startedAtMs?: number;
}

export interface ManagerRuntimeResult {
	readonly status: "completed" | "failed" | "cancelled";
	readonly graph: TaskGraph;
	readonly outputs: ReadonlyMap<string, RuntimeTaskExecutionResult>;
	readonly usage: ReturnType<ExecutionMeter["snapshot"]>;
	readonly failedTaskIds: readonly string[];
	readonly blockedTaskIds: readonly string[];
}

export class VerificationRepairRequest extends Error {
	readonly code = "AGENT_VERIFICATION_REPAIR_REQUESTED";
	readonly taskIds: readonly string[];

	constructor(taskIds: readonly string[], message = "Verification requested repair.") {
		super(message);
		this.name = "VerificationRepairRequest";
		this.taskIds = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
	}
}

function taskById(graph: TaskGraph, taskId: string): RuntimeTask {
	const task = graph.tasks.find((candidate) => candidate.id === taskId);
	if (!task) throw new Error(`Unknown task: ${taskId}`);
	return task;
}

function replaceTask(graph: TaskGraph, replacement: RuntimeTask): TaskGraph {
	return {
		tasks: graph.tasks.map((task) => (task.id === replacement.id ? replacement : task)),
	};
}

function maxAttempts(task: RuntimeTask, budget: ExecutionBudget): number {
	return Math.max(
		1,
		Math.min(task.maxAttempts ?? budget.maxRetriesPerTask + 1, budget.maxRetriesPerTask + 1),
	);
}

function retryAfterFailure(
	graph: TaskGraph,
	taskId: string,
	budget: ExecutionBudget,
): TaskGraph {
	const task = taskById(graph, taskId);
	return replaceTask(graph, {
		...task,
		status: task.attempt < maxAttempts(task, budget) ? "retrying" : "failed",
		blockedReason: undefined,
	});
}

function transitiveDependents(graph: TaskGraph, roots: ReadonlySet<string>): Set<string> {
	const selected = new Set(roots);
	let changed = true;
	while (changed) {
		changed = false;
		for (const task of graph.tasks) {
			if (selected.has(task.id)) continue;
			if (task.dependsOn.some((dependencyId) => selected.has(dependencyId))) {
				selected.add(task.id);
				changed = true;
			}
		}
	}
	return selected;
}

/**
 * Reopens verified/completed work only through an explicit verifier repair request.
 * Requested roots are retried only when their affected dependencies are already
 * stable. Transitive dependents return to pending so stale outputs cannot race an
 * upstream repair. Retry ceilings remain binding.
 */
export function applyVerificationRepair(
	graph: TaskGraph,
	requestedTaskIds: readonly string[],
	budget: ExecutionBudget,
): TaskGraph {
	validateTaskGraph(graph);
	const requested = new Set(requestedTaskIds);
	if (requested.size === 0) throw new Error("Verification repair requires at least one task id.");
	for (const taskId of requested) taskById(graph, taskId);

	const affected = transitiveDependents(graph, requested);
	return {
		tasks: graph.tasks.map((task) => {
			if (!affected.has(task.id)) return task;
			if (task.role === "verifier") {
				return { ...task, status: "pending" as const, blockedReason: undefined };
			}
			if (requested.has(task.id)) {
				if (task.attempt >= maxAttempts(task, budget)) {
					return { ...task, status: "failed" as const, blockedReason: undefined };
				}
				const affectedDependency = task.dependsOn.some((dependencyId) => affected.has(dependencyId));
				return {
					...task,
					status: affectedDependency ? ("pending" as const) : ("retrying" as const),
					blockedReason: undefined,
				};
			}
			return { ...task, status: "pending" as const, blockedReason: undefined };
		}),
	};
}

function terminalStatus(graph: TaskGraph): ManagerRuntimeResult["status"] | null {
	if (graph.tasks.every((task) => task.status === "completed")) return "completed";
	if (graph.tasks.some((task) => task.status === "failed" || task.status === "blocked")) {
		const unfinished = graph.tasks.some((task) =>
			["pending", "ready", "running", "retrying", "verifying", "waiting_for_tool", "waiting_for_approval"].includes(task.status),
		);
		if (!unfinished) return "failed";
	}
	if (graph.tasks.every((task) => task.status === "completed" || task.status === "cancelled")) {
		return graph.tasks.some((task) => task.status === "cancelled") ? "cancelled" : "completed";
	}
	return null;
}

function cancelOpenTasks(graph: TaskGraph): TaskGraph {
	return {
		tasks: graph.tasks.map((task) =>
			["completed", "failed", "cancelled"].includes(task.status)
				? task
				: { ...task, status: "cancelled" as const, blockedReason: undefined },
		),
	};
}

async function notifyTask(
	observer: ManagerRuntimeObserver | undefined,
	task: RuntimeTask,
): Promise<void> {
	await observer?.onTaskState?.(task);
}

export async function executeManagedTaskGraph(
	input: ManagerRuntimeInput,
): Promise<ManagerRuntimeResult> {
	validateTaskGraph(input.graph);
	const meter = new ExecutionMeter(input.budget, input.startedAtMs);
	const outputs = new Map<string, RuntimeTaskExecutionResult>();
	let graph = reconcileTaskReadiness(input.graph);
	let safetyTicks = 0;
	const maximumTicks = Math.max(20, graph.tasks.length * (input.budget.maxRetriesPerTask + 4) * 4);

	while (safetyTicks++ < maximumTicks) {
		if (input.abortSignal?.aborted) {
			graph = cancelOpenTasks(graph);
			return finish("cancelled");
		}

		const status = terminalStatus(graph);
		if (status) return finish(status);

		const decision = planSchedulerTick({
			graph,
			budget: input.budget,
			usage: meter.snapshot(),
		});
		graph = decision.graph;
		await input.observer?.onSchedulerDecision?.(decision);
		if (decision.budgetViolations.length > 0) return finish("failed");

		if (decision.startedTaskIds.length === 0) {
			graph = reconcileTaskReadiness(graph);
			const afterReconcile = terminalStatus(graph);
			if (afterReconcile) return finish(afterReconcile);
			const runnable = graph.tasks.some((task) => task.status === "ready" || task.status === "retrying");
			if (!runnable) return finish("failed");
			continue;
		}

		meter.setActiveAgents(decision.startedTaskIds.length);
		for (const taskId of decision.startedTaskIds) await notifyTask(input.observer, taskById(graph, taskId));

		const settled = await Promise.all(
			decision.startedTaskIds.map(async (taskId) => {
				const task = taskById(graph, taskId);
				try {
					const result = await input.executor.execute({
						objective: input.objective,
						task,
						outputs,
						abortSignal: input.abortSignal,
					});
					return { taskId, task, result } as const;
				} catch (error) {
					return { taskId, task, error } as const;
				}
			}),
		);
		meter.setActiveAgents(0);

		let repairRequest: VerificationRepairRequest | null = null;
		for (const item of settled) {
			if ("result" in item) {
				const result = item.result;
				meter.recordModelUsage(result.tokens ?? 0, result.estimatedCostUsd ?? 0);
				outputs.set(item.taskId, result);
				const completed = { ...taskById(graph, item.taskId), status: "completed" as const, blockedReason: undefined };
				graph = replaceTask(graph, completed);
				await input.observer?.onTaskResult?.(completed, result);
				await notifyTask(input.observer, completed);
				continue;
			}

			await input.observer?.onTaskError?.(item.task, item.error);
			if (item.error instanceof VerificationRepairRequest) {
				repairRequest = item.error;
				continue;
			}
			graph = retryAfterFailure(graph, item.taskId, input.budget);
			await notifyTask(input.observer, taskById(graph, item.taskId));
		}

		if (repairRequest) {
			graph = applyVerificationRepair(graph, repairRequest.taskIds, input.budget);
			for (const task of graph.tasks) {
				if (task.status === "retrying" || task.status === "pending") {
					outputs.delete(task.id);
					await notifyTask(input.observer, task);
				}
			}
		}

		graph = reconcileTaskReadiness(graph);
	}

	return finish("failed");

	function finish(status: ManagerRuntimeResult["status"]): ManagerRuntimeResult {
		return {
			status,
			graph,
			outputs,
			usage: meter.snapshot(),
			failedTaskIds: graph.tasks.filter((task) => task.status === "failed").map((task) => task.id),
			blockedTaskIds: graph.tasks.filter((task) => task.status === "blocked").map((task) => task.id),
		};
	}
}

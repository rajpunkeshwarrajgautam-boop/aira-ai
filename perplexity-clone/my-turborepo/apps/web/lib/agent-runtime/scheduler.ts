import { collectGlobalBudgetViolations } from "./execution-budget";
import { reconcileTaskReadiness, validateTaskGraph } from "./task-graph";
import type {
	ExecutionBudget,
	ExecutionUsage,
	RuntimeTask,
	SchedulerDecision,
	TaskGraph,
} from "./types";

export interface SchedulerTickInput {
	readonly graph: TaskGraph;
	readonly budget: ExecutionBudget;
	readonly usage: ExecutionUsage;
	readonly nowMs?: number;
}

function effectiveMaxAttempts(task: RuntimeTask, budget: ExecutionBudget): number {
	const budgetMaximum = budget.maxRetriesPerTask + 1;
	if (task.maxAttempts === undefined) return budgetMaximum;
	return Math.max(1, Math.min(Math.trunc(task.maxAttempts), budgetMaximum));
}

function candidateOrder(
	a: { task: RuntimeTask; index: number },
	b: { task: RuntimeTask; index: number },
): number {
	const priorityDelta = (b.task.priority ?? 0) - (a.task.priority ?? 0);
	return priorityDelta || a.index - b.index;
}

/**
 * Produces a deterministic scheduling decision without executing providers or tools.
 * The caller owns persistence and actual dispatch; this function only decides which
 * tasks may start under graph dependencies and the configured safety budget.
 */
export function planSchedulerTick(input: SchedulerTickInput): SchedulerDecision {
	validateTaskGraph(input.graph);
	let graph = reconcileTaskReadiness(input.graph);
	const blockedTaskIds: string[] = [];
	const failedTaskIds: string[] = [];

	graph = {
		tasks: graph.tasks.map((task) => {
			if (
				(task.status === "pending" ||
					task.status === "ready" ||
					task.status === "retrying") &&
				task.delegationDepth > input.budget.maxDelegationDepth
			) {
				blockedTaskIds.push(task.id);
				return {
					...task,
					status: "blocked" as const,
					blockedReason: `Delegation depth ${task.delegationDepth} exceeds limit ${input.budget.maxDelegationDepth}.`,
				};
			}

			if (
				(task.status === "ready" || task.status === "retrying") &&
				task.attempt >= effectiveMaxAttempts(task, input.budget)
			) {
				failedTaskIds.push(task.id);
				return {
					...task,
					status: "failed" as const,
					blockedReason: undefined,
				};
			}

			return task;
		}),
	};

	const budgetViolations = collectGlobalBudgetViolations(
		input.budget,
		input.usage,
		input.nowMs ?? Date.now(),
	);

	if (budgetViolations.length > 0) {
		return {
			graph,
			startedTaskIds: [],
			blockedTaskIds,
			failedTaskIds,
			budgetViolations,
		};
	}

	const availableSlots = Math.max(
		0,
		input.budget.maxConcurrentAgents - Math.max(0, input.usage.activeAgents),
	);
	if (availableSlots === 0) {
		return {
			graph,
			startedTaskIds: [],
			blockedTaskIds,
			failedTaskIds,
			budgetViolations: [],
		};
	}

	const candidates = graph.tasks
		.map((task, index) => ({ task, index }))
		.filter(({ task }) => task.status === "ready" || task.status === "retrying")
		.sort(candidateOrder)
		.slice(0, availableSlots);
	const selected = new Set(candidates.map(({ task }) => task.id));
	const startedTaskIds = candidates.map(({ task }) => task.id);

	graph = {
		tasks: graph.tasks.map((task) =>
			selected.has(task.id)
				? {
						...task,
						status: "running" as const,
						attempt: task.attempt + 1,
						blockedReason: undefined,
					}
				: task,
		),
	};

	return {
		graph,
		startedTaskIds,
		blockedTaskIds,
		failedTaskIds,
		budgetViolations: [],
	};
}

export function requestTaskRetry(
	graph: TaskGraph,
	taskId: string,
	budget: ExecutionBudget,
): TaskGraph {
	validateTaskGraph(graph);
	let found = false;

	const tasks = graph.tasks.map((task) => {
		if (task.id !== taskId) return task;
		found = true;
		if (task.status !== "failed" && task.status !== "verifying") {
			throw new Error(`Task ${taskId} cannot retry from ${task.status}.`);
		}
		if (task.attempt >= effectiveMaxAttempts(task, budget)) {
			return { ...task, status: "failed" as const };
		}
		return { ...task, status: "retrying" as const, blockedReason: undefined };
	});

	if (!found) throw new Error(`Unknown task: ${taskId}`);
	return { tasks };
}

export function cancelUnfinishedTasks(graph: TaskGraph): TaskGraph {
	validateTaskGraph(graph);
	return {
		tasks: graph.tasks.map((task) =>
			task.status === "completed" || task.status === "failed" || task.status === "cancelled"
				? task
				: { ...task, status: "cancelled" as const, blockedReason: undefined },
		),
	};
}

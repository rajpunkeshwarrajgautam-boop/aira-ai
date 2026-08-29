import type { RuntimeTask, RuntimeTaskStatus, TaskGraph } from "./types";

const FAILURE_DEPENDENCY_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
	"failed",
	"cancelled",
	"blocked",
]);

const READINESS_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
	"pending",
	"ready",
]);

export class TaskGraphValidationError extends Error {
	readonly code:
		| "EMPTY_TASK_ID"
		| "DUPLICATE_TASK_ID"
		| "MISSING_DEPENDENCY"
		| "SELF_DEPENDENCY"
		| "CYCLIC_DEPENDENCY";

	constructor(
		code: TaskGraphValidationError["code"],
		message: string,
	) {
		super(message);
		this.name = "TaskGraphValidationError";
		this.code = code;
	}
}

function taskMap(graph: TaskGraph): Map<string, RuntimeTask> {
	return new Map(graph.tasks.map((task) => [task.id, task]));
}

export function validateTaskGraph(graph: TaskGraph): void {
	const ids = new Set<string>();

	for (const task of graph.tasks) {
		if (!task.id.trim()) {
			throw new TaskGraphValidationError("EMPTY_TASK_ID", "Task ids must be non-empty.");
		}
		if (ids.has(task.id)) {
			throw new TaskGraphValidationError(
				"DUPLICATE_TASK_ID",
				`Duplicate task id: ${task.id}`,
			);
		}
		ids.add(task.id);
	}

	for (const task of graph.tasks) {
		for (const dependencyId of task.dependsOn) {
			if (dependencyId === task.id) {
				throw new TaskGraphValidationError(
					"SELF_DEPENDENCY",
					`Task ${task.id} cannot depend on itself.`,
				);
			}
			if (!ids.has(dependencyId)) {
				throw new TaskGraphValidationError(
					"MISSING_DEPENDENCY",
					`Task ${task.id} depends on missing task ${dependencyId}.`,
				);
			}
		}
	}

	const byId = taskMap(graph);
	const visiting = new Set<string>();
	const visited = new Set<string>();

	function visit(taskId: string, path: readonly string[]): void {
		if (visited.has(taskId)) return;
		if (visiting.has(taskId)) {
			const cycleStart = path.indexOf(taskId);
			const cycle = [...path.slice(Math.max(0, cycleStart)), taskId].join(" -> ");
			throw new TaskGraphValidationError(
				"CYCLIC_DEPENDENCY",
				`Task graph contains a cycle: ${cycle}`,
			);
		}

		visiting.add(taskId);
		const task = byId.get(taskId);
		if (task) {
			for (const dependencyId of task.dependsOn) {
				visit(dependencyId, [...path, taskId]);
			}
		}
		visiting.delete(taskId);
		visited.add(taskId);
	}

	for (const task of graph.tasks) visit(task.id, []);
}

export function topologicalTaskOrder(graph: TaskGraph): readonly string[] {
	validateTaskGraph(graph);
	const byId = taskMap(graph);
	const visited = new Set<string>();
	const ordered: string[] = [];

	function visit(taskId: string): void {
		if (visited.has(taskId)) return;
		const task = byId.get(taskId);
		if (!task) return;
		for (const dependencyId of task.dependsOn) visit(dependencyId);
		visited.add(taskId);
		ordered.push(taskId);
	}

	for (const task of graph.tasks) visit(task.id);
	return ordered;
}

export function reconcileTaskReadiness(graph: TaskGraph): TaskGraph {
	validateTaskGraph(graph);
	const byId = taskMap(graph);

	return {
		tasks: graph.tasks.map((task) => {
			if (!READINESS_STATUSES.has(task.status)) return task;

			const dependencies = task.dependsOn.map((dependencyId) => byId.get(dependencyId)!);
			const failedDependency = dependencies.find((dependency) =>
				FAILURE_DEPENDENCY_STATUSES.has(dependency.status),
			);

			if (failedDependency) {
				return {
					...task,
					status: "blocked" as const,
					blockedReason: `Dependency ${failedDependency.id} is ${failedDependency.status}.`,
				};
			}

			const ready = dependencies.every((dependency) => dependency.status === "completed");
			return {
				...task,
				status: ready ? ("ready" as const) : ("pending" as const),
				blockedReason: undefined,
			};
		}),
	};
}

const ALLOWED_TRANSITIONS: Readonly<Record<RuntimeTaskStatus, ReadonlySet<RuntimeTaskStatus>>> = {
	pending: new Set(["ready", "blocked", "cancelled"]),
	ready: new Set(["running", "blocked", "cancelled"]),
	running: new Set([
		"waiting_for_tool",
		"waiting_for_approval",
		"verifying",
		"retrying",
		"completed",
		"failed",
		"cancelled",
	]),
	waiting_for_tool: new Set(["running", "retrying", "failed", "cancelled"]),
	waiting_for_approval: new Set(["running", "failed", "cancelled"]),
	blocked: new Set(["pending", "cancelled"]),
	verifying: new Set(["completed", "retrying", "failed", "cancelled"]),
	retrying: new Set(["ready", "running", "failed", "cancelled"]),
	completed: new Set(),
	failed: new Set(["retrying"]),
	cancelled: new Set(),
};

export function canTransitionTaskStatus(
	from: RuntimeTaskStatus,
	to: RuntimeTaskStatus,
): boolean {
	return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

export function transitionTaskStatus(
	task: RuntimeTask,
	to: RuntimeTaskStatus,
	blockedReason?: string,
): RuntimeTask {
	if (!canTransitionTaskStatus(task.status, to)) {
		throw new Error(`Invalid task transition: ${task.id} ${task.status} -> ${to}`);
	}
	return {
		...task,
		status: to,
		blockedReason: to === "blocked" ? blockedReason ?? task.blockedReason : undefined,
	};
}

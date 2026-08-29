import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { validateTaskGraph } from "./task-graph";
import type { AgentRole, RuntimeTask, TaskGraph } from "./types";

const SPECIALIST_ROLES = [
	"researcher",
	"coder",
	"browser_operator",
	"designer",
	"analyst",
	"verifier",
] as const satisfies readonly AgentRole[];

const PlannerTaskSchema = z.object({
	id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	title: z.string().trim().min(3).max(160),
	description: z.string().trim().min(3).max(1_200),
	role: z.enum(SPECIALIST_ROLES),
	dependsOn: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).max(12).default([]),
	priority: z.number().int().min(0).max(100).default(50),
});

const PlannerOutputSchema = z.object({
	summary: z.string().trim().min(3).max(600),
	tasks: z.array(PlannerTaskSchema).min(1).max(12),
});

type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export interface ExecutionPlan {
	readonly objective: string;
	readonly summary: string;
	readonly graph: TaskGraph;
}

export interface PlannerModelRouter {
	streamChat(
		messages: ChatCompletionMessageParam[],
		options?: { readonly temperature?: number; readonly abortSignal?: AbortSignal },
	): AsyncGenerator<string, void, undefined>;
}

export class PlannerOutputError extends Error {
	readonly code = "AGENT_PLANNER_OUTPUT_INVALID";

	constructor(message: string) {
		super(message);
		this.name = "PlannerOutputError";
	}
}

function extractJsonObject(raw: string): unknown {
	const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) throw new PlannerOutputError("Planner did not return a JSON object.");
	try {
		return JSON.parse(trimmed.slice(start, end + 1));
	} catch {
		throw new PlannerOutputError("Planner returned malformed JSON.");
	}
}

function leafTaskIds(tasks: readonly PlannerOutput["tasks"][number][]): readonly string[] {
	const dependedOn = new Set(tasks.flatMap((task) => task.dependsOn));
	return tasks.filter((task) => task.role !== "verifier" && !dependedOn.has(task.id)).map((task) => task.id);
}

function normalizeFinalVerifier(output: PlannerOutput): PlannerOutput {
	const verifierTasks = output.tasks.filter((task) => task.role === "verifier");
	if (verifierTasks.length > 1) {
		throw new PlannerOutputError("Planner may create only one final verifier task.");
	}
	const verifier = verifierTasks[0];
	if (verifier && output.tasks.some((task) => task.dependsOn.includes(verifier.id))) {
		throw new PlannerOutputError("Final verifier cannot be a dependency of worker tasks.");
	}
	const leaves = leafTaskIds(output.tasks);
	if (verifier) {
		return {
			...output,
			tasks: output.tasks.map((task) =>
				task.id === verifier.id
					? { ...task, dependsOn: [...new Set([...task.dependsOn, ...leaves])] }
					: task,
			),
		};
	}

	let verifierId = "verify-final";
	const ids = new Set(output.tasks.map((task) => task.id));
	let suffix = 2;
	while (ids.has(verifierId)) verifierId = `verify-final-${suffix++}`;
	return {
		...output,
		tasks: [
			...output.tasks,
			{
				id: verifierId,
				title: "Verify final outcome",
				description: "Independently verify completed work against the user's objective and recorded evidence.",
				role: "verifier",
				dependsOn: [...leaves],
				priority: 100,
			},
		],
	};
}

export function parseExecutionPlan(objective: string, raw: string): ExecutionPlan {
	const normalizedObjective = objective.trim();
	if (normalizedObjective.length < 3) throw new PlannerOutputError("Objective is too short to plan.");
	const parsed = PlannerOutputSchema.safeParse(extractJsonObject(raw));
	if (!parsed.success) {
		throw new PlannerOutputError(`Planner output failed schema validation: ${z.prettifyError(parsed.error)}`);
	}
	const output = normalizeFinalVerifier(parsed.data);
	const tasks: RuntimeTask[] = output.tasks.map((task) => ({
		id: task.id,
		title: task.title,
		description: task.description,
		role: task.role,
		dependsOn: task.dependsOn,
		status: "pending",
		priority: task.priority,
		attempt: 0,
		delegationDepth: 1,
	}));
	const graph: TaskGraph = { tasks };
	try {
		validateTaskGraph(graph);
	} catch (error) {
		throw new PlannerOutputError(error instanceof Error ? error.message : "Planner produced an invalid task graph.");
	}
	return { objective: normalizedObjective, summary: output.summary, graph };
}

const PLANNER_SYSTEM_PROMPT = `You are AIRA's private execution planner. Convert the user's objective into the smallest dependency-aware plan that can actually be executed by specialist agents.

Rules:
- Return JSON only. No markdown and no hidden reasoning.
- Use only these roles: researcher, coder, browser_operator, designer, analyst, verifier.
- Prefer independent tasks that can run concurrently.
- Dependencies must reference task ids in this same plan.
- Use browser_operator only when browser observation or interaction is materially required.
- Use coder only for repository/file/code implementation work.
- Make consequential external actions explicit in task descriptions; approval is enforced later by the tool boundary.
- Include at most one verifier. If present it must be the final independent QA task and must never be a dependency of another task.
- Do not invent credentials, tools, successful results, deployments, or external state.

Required schema:
{"summary":"string","tasks":[{"id":"lowercase-id","title":"string","description":"string","role":"researcher|coder|browser_operator|designer|analyst|verifier","dependsOn":["task-id"],"priority":0}]}`;

export async function planObjective(
	objective: string,
	options: { readonly router?: PlannerModelRouter; readonly abortSignal?: AbortSignal } = {},
): Promise<ExecutionPlan> {
	let router = options.router;
	if (!router) {
		const { ProviderRouter } = await import("@services/providers/provider-router");
		router = await ProviderRouter.createDefault();
	}
	const messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: PLANNER_SYSTEM_PROMPT },
		{ role: "user", content: objective },
	];
	let raw = "";
	for await (const delta of router.streamChat(messages, {
		temperature: 0.1,
		abortSignal: options.abortSignal,
	})) {
		raw += delta;
	}
	return parseExecutionPlan(objective, raw);
}

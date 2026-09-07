import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { globalArtifactEngine } from "../artifacts/engine";
import { globalConnectorRegistry } from "../connectors/registry";
import type { ConnectorCredential } from "../connectors/types";
import { globalConnectorCredentialStore, redactSecrets } from "../connectors/credential-store";
import { globalAutomationApprovalStore, computeParametersHash } from "./approvals";
import { executeTool } from "../tool-gateway/gateway";
import type { AiraToolId } from "../tool-gateway/types";
import { selectAgentRuntime } from "../agent-runtime/registry";
import type { AgentRuntimeId } from "../agent-runtime/types";
import { evaluateCondition } from "./condition-evaluator";
import { prisma } from "@/lib/prisma";

export type WorkflowNodeType =
	| "trigger"
	| "agent"
	| "tool"
	| "connector"
	| "approval"
	| "condition"
	| "deliverable_export";

export type NodeFailurePolicy = "FAIL_WORKFLOW" | "CONTINUE" | "RETRY" | "BRANCH";

export interface WorkflowNode {
	readonly id: string;
	readonly type: WorkflowNodeType;
	readonly name: string;
	readonly config: Record<string, unknown>;
	readonly inputBindings: Record<string, string>; // targetParam -> "sourceNodeId.outputKey"
	readonly failurePolicy?: NodeFailurePolicy;
	readonly mandatory?: boolean;
}

export interface WorkflowEdge {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly targetNodeId: string;
	readonly condition?: string;
}

export interface VisualWorkflowDAG {
	readonly id: string;
	readonly name: string;
	readonly version: number;
	readonly description: string;
	readonly nodes: readonly WorkflowNode[];
	readonly edges: readonly WorkflowEdge[];
}

export const RoutineTriggerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("cron"),
		cronExpression: z.string(),
		timezone: z.string().default("UTC"),
	}),
	z.object({
		type: z.literal("interval"),
		intervalMinutes: z.number().positive(),
	}),
	z.object({
		type: z.literal("webhook"),
		secretToken: z.string().optional(),
	}),
	z.object({
		type: z.literal("connector_event"),
		connectorId: z.string(),
		eventName: z.string(),
	}),
	z.object({
		type: z.literal("manual"),
	}),
]);

export type RoutineTrigger = z.infer<typeof RoutineTriggerSchema>;

export const RoutineDefinitionSchema = z.object({
	id: z.string(),
	userId: z.string(),
	name: z.string(),
	description: z.string().default(""),
	enabled: z.boolean().default(true),
	version: z.number().default(1),
	trigger: RoutineTriggerSchema,
	workflowDag: z.any(),
	budgetUsd: z.number().default(5.0),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export interface RoutineDefinition {
	readonly id: string;
	readonly userId: string;
	readonly name: string;
	readonly description: string;
	readonly enabled: boolean;
	readonly version: number;
	readonly trigger: RoutineTrigger;
	readonly workflowDag: VisualWorkflowDAG;
	readonly budgetUsd: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type RoutineExecutionStatus =
	| "PENDING"
	| "WAITING"
	| "RUNNING"
	| "WAITING_APPROVAL"
	| "SUCCEEDED"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED";

export interface RoutineExecutionRecord {
	readonly id: string;
	readonly routineId: string;
	readonly userId: string;
	readonly status: RoutineExecutionStatus;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly stepOutputs: Record<string, unknown>;
	readonly totalCostUsd: number;
	readonly error?: string;
	readonly failedNodeId?: string;
	readonly pendingApprovalNodeId?: string;
	readonly pendingApprovalId?: string;
	readonly idempotencyKey?: string;
}

export interface NotificationItem {
	readonly id: string;
	readonly userId: string;
	readonly title: string;
	readonly message: string;
	readonly category: "routine" | "approval" | "security" | "deliverable" | "system";
	readonly read: boolean;
	readonly link?: string;
	readonly createdAt: string;
}

export class AutomationEngine {
	private readonly storeDir: string;
	private readonly routinesPath: string;
	private readonly runsPath: string;
	private readonly notificationsPath: string;

	private routines = new Map<string, RoutineDefinition>();
	private executionHistory: RoutineExecutionRecord[] = [];
	private notifications = new Map<string, NotificationItem[]>();

	// Template Gallery (Gate 114)
	readonly templates: readonly VisualWorkflowDAG[] = [
		{
			id: "template-lead-research-crm",
			name: "Daily Executive Lead Research & CRM Sync",
			version: 1,
			description: "Extracts daily prospective accounts, verifies company financials, generates briefing and updates CRM pipeline.",
			nodes: [
				{ id: "node_1", type: "trigger", name: "Scheduled Daily 08:00 AM", config: { schedule: "0 8 * * *" }, inputBindings: {} },
				{ id: "node_2", type: "agent", name: "Research Intelligence Agent", config: { skills: ["analytics", "product-discovery"], role: "RESEARCH" }, inputBindings: {} },
				{ id: "node_3", type: "approval", name: "Executive Review Fence", config: { prompt: "Confirm adding enriched leads to active pipeline?" }, inputBindings: {} },
				{ id: "node_4", type: "connector", name: "CRM Lead Sync", config: { connectorId: "crm", action: "create_lead" }, inputBindings: {} },
				{ id: "node_5", type: "deliverable_export", name: "Export Lead Dossier", config: { format: "MARKDOWN" }, inputBindings: {} },
			],
			edges: [
				{ id: "edge_1_2", sourceNodeId: "node_1", targetNodeId: "node_2" },
				{ id: "edge_2_3", sourceNodeId: "node_2", targetNodeId: "node_3" },
				{ id: "edge_3_4", sourceNodeId: "node_3", targetNodeId: "node_4" },
				{ id: "edge_4_5", sourceNodeId: "node_4", targetNodeId: "node_5" },
			],
		},
		{
			id: "template-weekly-financial-audit",
			name: "Weekly Financial Summary & Spreadsheet Generation",
			version: 1,
			description: "Pulls ecommerce and subscription revenue, calculates burn metrics, and compiles XLSX report.",
			nodes: [
				{ id: "node_1", type: "trigger", name: "Every Monday 06:00 AM", config: { schedule: "0 6 * * 1" }, inputBindings: {} },
				{ id: "node_2", type: "connector", name: "Ecommerce Revenue Ingestion", config: { connectorId: "ecommerce", action: "list_orders" }, inputBindings: {} },
				{ id: "node_3", type: "agent", name: "Financial Modeler", config: { skills: ["finance", "analytics"], role: "ANALYST" }, inputBindings: {} },
				{ id: "node_4", type: "deliverable_export", name: "Generate Spreadsheet", config: { format: "CSV" }, inputBindings: {} },
			],
			edges: [
				{ id: "edge_1_2", sourceNodeId: "node_1", targetNodeId: "node_2" },
				{ id: "edge_2_3", sourceNodeId: "node_2", targetNodeId: "node_3" },
				{ id: "edge_3_4", sourceNodeId: "node_3", targetNodeId: "node_4" },
			],
		},
	];

	constructor(storagePath?: string) {
		this.storeDir = storagePath ?? process.env.AIRA_DATA_DIR ?? join(process.cwd(), ".aira-store");
		this.routinesPath = join(this.storeDir, "automation-routines.json");
		this.runsPath = join(this.storeDir, "automation-runs.json");
		this.notificationsPath = join(this.storeDir, "automation-notifications.json");

		this.ensureStorageDir();
		this.loadFromDisk();
	}

	private ensureStorageDir(): void {
		try {
			if (!existsSync(this.storeDir)) {
				mkdirSync(this.storeDir, { recursive: true });
			}
		} catch {
			// fallback
		}
	}

	private loadFromDisk(): void {
		try {
			if (existsSync(this.routinesPath)) {
				const raw = readFileSync(this.routinesPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					for (const r of parsed) this.routines.set(r.id, r);
				}
			}
			if (existsSync(this.runsPath)) {
				const raw = readFileSync(this.runsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					this.executionHistory = parsed;
				}
			}
			if (existsSync(this.notificationsPath)) {
				const raw = readFileSync(this.notificationsPath, "utf8");
				const parsed = JSON.parse(raw);
				if (typeof parsed === "object" && parsed !== null) {
					for (const [k, v] of Object.entries(parsed)) {
						if (Array.isArray(v)) this.notifications.set(k, v as NotificationItem[]);
					}
				}
			}
		} catch {
			// fail-safe read
		}
	}

	private persistToDisk(): void {
		try {
			this.ensureStorageDir();
			const routinesArr = [...this.routines.values()];
			const tempR = `${this.routinesPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempR, JSON.stringify(routinesArr, null, 2), "utf8");
			renameSync(tempR, this.routinesPath);

			const tempRuns = `${this.runsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempRuns, JSON.stringify(this.executionHistory, null, 2), "utf8");
			renameSync(tempRuns, this.runsPath);

			const notifsObj = Object.fromEntries(this.notifications.entries());
			const tempN = `${this.notificationsPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
			writeFileSync(tempN, JSON.stringify(notifsObj, null, 2), "utf8");
			renameSync(tempN, this.notificationsPath);
		} catch {
			// fail-safe write
		}
	}

	async createRoutineAsync(params: {
		userId: string;
		name: string;
		description?: string;
		enabled?: boolean;
		trigger: RoutineTrigger;
		workflowDag: VisualWorkflowDAG;
		budgetUsd?: number;
	}): Promise<RoutineDefinition> {
		const id = `routine-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();
		const routine: RoutineDefinition = {
			id,
			userId: params.userId,
			name: params.name,
			description: params.description ?? "",
			enabled: params.enabled ?? true,
			version: 1,
			trigger: params.trigger,
			workflowDag: params.workflowDag,
			budgetUsd: params.budgetUsd ?? 5.0,
			createdAt: now,
			updatedAt: now,
		};

		if (process.env.DATABASE_URL) {
			await prisma.$transaction(async (tx) => {
				await tx.automationRoutine.create({
					data: {
						id: routine.id,
						userId: routine.userId,
						name: routine.name,
						description: routine.description,
						triggerType: routine.trigger.type,
						triggerConfig: routine.trigger as never,
						status: routine.enabled ? "ACTIVE" : "PAUSED",
						version: 1,
						workflowDag: routine.workflowDag as never,
					},
				});
				await tx.automationRoutineVersion.create({
					data: {
						routineId: routine.id,
						version: 1,
						workflowDag: routine.workflowDag as never,
					},
				});
			});
		}

		this.routines.set(id, routine);
		this.persistToDisk();
		return routine;
	}

	createRoutine(params: {
		userId: string;
		name: string;
		description?: string;
		enabled?: boolean;
		trigger: RoutineTrigger;
		workflowDag: VisualWorkflowDAG;
		budgetUsd?: number;
	}): RoutineDefinition {
		const id = `routine-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		const now = new Date().toISOString();
		const routine: RoutineDefinition = {
			id,
			userId: params.userId,
			name: params.name,
			description: params.description ?? "",
			enabled: params.enabled ?? true,
			version: 1,
			trigger: params.trigger,
			workflowDag: params.workflowDag,
			budgetUsd: params.budgetUsd ?? 5.0,
			createdAt: now,
			updatedAt: now,
		};

		this.routines.set(id, routine);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.$transaction(async (tx) => {
				await tx.automationRoutine.create({
					data: {
						id: routine.id,
						userId: routine.userId,
						name: routine.name,
						description: routine.description,
						triggerType: routine.trigger.type,
						triggerConfig: routine.trigger as never,
						status: routine.enabled ? "ACTIVE" : "PAUSED",
						version: 1,
						workflowDag: routine.workflowDag as never,
					},
				});
				await tx.automationRoutineVersion.create({
					data: {
						routineId: routine.id,
						version: 1,
						workflowDag: routine.workflowDag as never,
					},
				});
			});
		}

		return routine;
	}

	async getRoutineAsync(userId: string, id: string): Promise<RoutineDefinition | null> {
		if (process.env.DATABASE_URL) {
			const dbRoutine = await prisma.automationRoutine.findUnique({
				where: { id },
			});
			if (!dbRoutine || dbRoutine.userId !== userId) return null;
			return {
				id: dbRoutine.id,
				userId: dbRoutine.userId,
				name: dbRoutine.name,
				description: dbRoutine.description,
				enabled: dbRoutine.status === "ACTIVE",
				version: dbRoutine.version,
				trigger: dbRoutine.triggerConfig as RoutineTrigger,
				workflowDag: dbRoutine.workflowDag as unknown as VisualWorkflowDAG,
				budgetUsd: 5.0,
				createdAt: dbRoutine.createdAt.toISOString(),
				updatedAt: dbRoutine.updatedAt.toISOString(),
			};
		}
		const r = this.routines.get(id);
		if (!r || r.userId !== userId) return null;
		return r;
	}

	getRoutine(userId: string, id: string): RoutineDefinition | null {
		const r = this.routines.get(id);
		if (!r || r.userId !== userId) return null;
		return r;
	}

	async listRoutinesAsync(userId: string): Promise<readonly RoutineDefinition[]> {
		if (process.env.DATABASE_URL) {
			const list = await prisma.automationRoutine.findMany({
				where: { userId },
				orderBy: { createdAt: "desc" },
			});
			return list.map((r) => ({
				id: r.id,
				userId: r.userId,
				name: r.name,
				description: r.description,
				enabled: r.status === "ACTIVE",
				version: r.version,
				trigger: r.triggerConfig as RoutineTrigger,
				workflowDag: r.workflowDag as unknown as VisualWorkflowDAG,
				budgetUsd: 5.0,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			}));
		}
		return [...this.routines.values()].filter((r) => r.userId === userId);
	}

	listRoutines(userId: string): readonly RoutineDefinition[] {
		return [...this.routines.values()].filter((r) => r.userId === userId);
	}

	listUserRoutines(userId: string): readonly RoutineDefinition[] {
		return this.listRoutines(userId);
	}

	async deleteRoutineAsync(userId: string, id: string): Promise<boolean> {
		if (process.env.DATABASE_URL) {
			const existing = await prisma.automationRoutine.findUnique({ where: { id } });
			if (!existing || existing.userId !== userId) return false;
			await prisma.automationRoutine.delete({ where: { id } });
		}
		const deleted = this.routines.delete(id);
		this.persistToDisk();
		return deleted;
	}

	deleteRoutine(userId: string, id: string): boolean {
		const r = this.routines.get(id);
		if (!r || r.userId !== userId) return false;
		const deleted = this.routines.delete(id);
		this.persistToDisk();
		if (process.env.DATABASE_URL) {
			void prisma.automationRoutine.delete({ where: { id } }).catch(() => null);
		}
		return deleted;
	}

	// Visual Builder DAG Cycle Detection, Topological Sort & Secret Rejection (Gate 116 & TruthMode IV)
	validateDAG(dag: VisualWorkflowDAG): { valid: boolean; cycles: boolean; order: string[]; secretsDetected?: boolean; error?: string } {
		const FORBIDDEN_SECRET_KEYS = new Set([
			"credential",
			"accesstoken",
			"refreshtoken",
			"bearertoken",
			"token",
			"apikey",
			"clientsecret",
			"signingsecret",
			"password",
			"secret",
			"privatekey",
		]);

		function hasSecrets(obj: unknown, depth = 0): boolean {
			if (depth > 10 || !obj || typeof obj !== "object") return false;
			for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
				const normalized = k.toLowerCase().replace(/[-_]/g, "");
				if (
					FORBIDDEN_SECRET_KEYS.has(normalized) ||
					normalized.includes("token") ||
					normalized.includes("secret") ||
					normalized.includes("apikey") ||
					normalized.includes("credential") ||
					normalized.includes("password")
				) return true;
				if (typeof v === "object" && v !== null && hasSecrets(v, depth + 1)) return true;
			}
			return false;
		}

		if (hasSecrets(dag.nodes)) {
			return {
				valid: false,
				cycles: false,
				order: [],
				secretsDetected: true,
				error: "Workflow DAG contains forbidden credential/secret fields. Store credentials in encrypted credential store via connectionId.",
			};
		}

		const inDegree = new Map<string, number>();
		const adj = new Map<string, string[]>();

		for (const node of dag.nodes) {
			inDegree.set(node.id, 0);
			adj.set(node.id, []);
		}

		for (const edge of dag.edges ?? []) {
			if (!inDegree.has(edge.sourceNodeId) || !inDegree.has(edge.targetNodeId)) {
				return { valid: false, cycles: false, order: [], error: "DAG has disjoint edge references." };
			}
			adj.get(edge.sourceNodeId)!.push(edge.targetNodeId);
			inDegree.set(edge.targetNodeId, inDegree.get(edge.targetNodeId)! + 1);
		}

		const queue: string[] = [];
		for (const [nodeId, deg] of inDegree.entries()) {
			if (deg === 0) queue.push(nodeId);
		}

		const order: string[] = [];
		while (queue.length > 0) {
			const curr = queue.shift()!;
			order.push(curr);
			for (const next of adj.get(curr) ?? []) {
				inDegree.set(next, inDegree.get(next)! - 1);
				if (inDegree.get(next) === 0) {
					queue.push(next);
				}
			}
		}

		const cycles = order.length !== dag.nodes.length;
		return { valid: !cycles, cycles, order, error: cycles ? "DAG contains cycle." : undefined };
	}

	private async saveRunRecord(record: RoutineExecutionRecord): Promise<void> {
		this.executionHistory = this.executionHistory.filter((r) => r.id !== record.id);
		this.executionHistory.push(record);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			await prisma.automationRoutineRun.upsert({
				where: { id: record.id },
				create: {
					id: record.id,
					routineId: record.routineId,
					userId: record.userId,
					status: record.status,
					startedAt: new Date(record.startedAt),
					completedAt: record.completedAt ? new Date(record.completedAt) : null,
					stepOutputs: record.stepOutputs as never,
					totalCostUsd: record.totalCostUsd,
					errorMessage: record.error ?? null,
					idempotencyKey: record.idempotencyKey ?? null,
				},
				update: {
					status: record.status,
					completedAt: record.completedAt ? new Date(record.completedAt) : null,
					stepOutputs: record.stepOutputs as never,
					totalCostUsd: record.totalCostUsd,
					errorMessage: record.error ?? null,
				},
			});
		}
	}

	async getRunRecordAsync(userId: string, id: string): Promise<RoutineExecutionRecord | null> {
		if (process.env.DATABASE_URL) {
			const dbRun = await prisma.automationRoutineRun.findUnique({
				where: { id },
			});
			if (!dbRun || dbRun.userId !== userId) return null;
			return {
				id: dbRun.id,
				routineId: dbRun.routineId,
				userId: dbRun.userId,
				status: dbRun.status as RoutineExecutionStatus,
				startedAt: dbRun.startedAt.toISOString(),
				completedAt: dbRun.completedAt ? dbRun.completedAt.toISOString() : undefined,
				stepOutputs: (dbRun.stepOutputs as Record<string, unknown>) ?? {},
				totalCostUsd: dbRun.totalCostUsd,
				error: dbRun.errorMessage ?? undefined,
				idempotencyKey: dbRun.idempotencyKey ?? undefined,
			};
		}
		const run = this.executionHistory.find((r) => r.id === id);
		if (!run || run.userId !== userId) return null;
		return run;
	}

	getRunRecord(userId: string, id: string): RoutineExecutionRecord | null {
		const run = this.executionHistory.find((r) => r.id === id);
		if (!run || run.userId !== userId) return null;
		return run;
	}

	// Real workflow node dispatch (Gates 49, 108, 109, 110 & TruthMode IV)
	async executeWorkflow(
		routineId: string,
		userId: string,
		options?: { idempotencyKey?: string; approvalId?: string; runId?: string },
	): Promise<RoutineExecutionRecord> {
		const routine = await this.getRoutineAsync(userId, routineId);
		if (!routine || routine.userId !== userId) throw new Error("Routine not found or unauthorized");

		// Idempotency check: if identical key already completed/succeeded, return existing
		if (options?.idempotencyKey) {
			if (process.env.DATABASE_URL) {
				const dbRun = await prisma.automationRoutineRun.findFirst({
					where: {
						idempotencyKey: options.idempotencyKey,
						userId,
						status: { in: ["COMPLETED", "SUCCEEDED"] },
					},
				});
				if (dbRun) {
					return {
						id: dbRun.id,
						routineId: dbRun.routineId,
						userId: dbRun.userId,
						status: dbRun.status as RoutineExecutionStatus,
						startedAt: dbRun.startedAt.toISOString(),
						completedAt: dbRun.completedAt?.toISOString(),
						stepOutputs: (dbRun.stepOutputs as Record<string, unknown>) ?? {},
						totalCostUsd: dbRun.totalCostUsd,
						idempotencyKey: dbRun.idempotencyKey ?? undefined,
					};
				}
			} else {
				const existing = this.executionHistory.find(
					(e) => e.idempotencyKey === options.idempotencyKey && e.userId === userId && (e.status === "COMPLETED" || e.status === "SUCCEEDED"),
				);
				if (existing) return existing;
			}
		}

		const { valid, order, error: dagError } = this.validateDAG(routine.workflowDag);
		if (!valid) throw new Error(`Workflow definition invalid: ${dagError || "cycles or forbidden secret fields detected."}`);

		let execId = options?.runId ?? `exec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
		let startedAt = new Date().toISOString();
		let stepOutputs: Record<string, unknown> = {};
		let totalCost = 0;

		if (options?.runId) {
			const existingRun = await this.getRunRecordAsync(userId, options.runId);
			if (existingRun) {
				stepOutputs = { ...existingRun.stepOutputs };
				totalCost = existingRun.totalCostUsd;
				startedAt = existingRun.startedAt;
			}
		} else if (options?.approvalId) {
			const appr = await globalAutomationApprovalStore.getApprovalAsync(options.approvalId);
			if (appr?.runId) {
				execId = appr.runId;
				const existingRun = await this.getRunRecordAsync(userId, execId);
				if (existingRun) {
					stepOutputs = { ...existingRun.stepOutputs };
					totalCost = existingRun.totalCostUsd;
					startedAt = existingRun.startedAt;
				}
			}
		}

		// Persist initial RUNNING state
		await this.saveRunRecord({
			id: execId,
			routineId: routine.id,
			userId,
			status: "RUNNING",
			startedAt,
			stepOutputs,
			totalCostUsd: totalCost,
			idempotencyKey: options?.idempotencyKey,
		});

		try {
			for (const nodeId of order) {
				const node = routine.workflowDag.nodes.find((n) => n.id === nodeId);
				if (!node) continue;

				if (stepOutputs[node.id] && node.type !== "approval") {
					continue;
				}

				const failurePolicy: NodeFailurePolicy = (node.config.failurePolicy as NodeFailurePolicy) ?? node.failurePolicy ?? "FAIL_WORKFLOW";

				try {
					// REAL DISPATCH BY NODE TYPE
					switch (node.type) {
						case "trigger": {
							stepOutputs[node.id] = {
								firedAt: new Date().toISOString(),
								type: routine.trigger.type,
								routineId: routine.id,
								status: "FIRED",
							};
							break;
						}

						case "agent": {
							const agentRole = (node.config.role as string) ?? "RESEARCH";
							const skills = Array.isArray(node.config.skills) ? (node.config.skills as string[]) : [];
							const missionPrompt = (node.config.prompt as string) || (node.config.instructions as string) || `${node.name}: Analyze task and execute role ${agentRole}.`;
							const requestedRuntime = (node.config.runtimeId as AgentRuntimeId | undefined) ?? (node.config.provider as AgentRuntimeId | undefined);

							const runtime = await selectAgentRuntime(requestedRuntime);
							const runtimeId = runtime.id;

							const clientRequestId = `wf_agent_${execId}_${node.id}`;
							const submission = await runtime.createRun({
								userId,
								clientRequestId,
								objective: missionPrompt,
								billingMode: "DELEGATED",
							});

							const runStatus = submission.run.status;
							if (runStatus === "FAILED" || runStatus === "TERMINATED") {
								throw new Error(submission.run.errorMessage || `Agent runtime ${runtimeId} reported task failure.`);
							}

							const resultObj = typeof submission.run.result === "object" && submission.run.result !== null
								? (submission.run.result as Record<string, unknown>)
								: undefined;
							const tokensUsed = typeof resultObj?.tokensUsed === "number"
								? resultObj.tokensUsed
								: typeof resultObj?.tokens === "number"
								? resultObj.tokens
								: undefined;
							const costUsd = typeof resultObj?.costUsd === "number"
								? resultObj.costUsd
								: typeof resultObj?.totalCostUsd === "number"
								? resultObj.totalCostUsd
								: undefined;

							if (typeof costUsd === "number" && !Number.isNaN(costUsd)) {
								totalCost += costUsd;
							}

							const agentOutput = typeof submission.run.result === "string"
								? submission.run.result
								: submission.run.result
								? JSON.stringify(submission.run.result)
								: `Runtime ${runtimeId} successfully processed task ${submission.run.id}.`;

							stepOutputs[node.id] = redactSecrets({
								status: "SUCCESS",
								agentRole,
								runtimeId,
								runId: submission.run.id,
								provider: submission.run.provider,
								skills,
								output: agentOutput,
								...(tokensUsed !== undefined ? { tokensUsed } : {}),
								...(costUsd !== undefined ? { costUsd } : {}),
								completedAt: new Date().toISOString(),
							});
							break;
						}

						case "tool": {
							const toolName = (node.config.tool as string) || (node.config.toolName as string) || (node.config.toolId as string) || "files";
							const action = (node.config.action as string) ?? "read";
							const input = (node.config.parameters as Record<string, unknown>) ?? (node.config.input as Record<string, unknown>) ?? {};

							const toolResult = await executeTool(
								{
									userId,
									projectId: (node.config.projectId as string) ?? "proj_default",
									runId: execId,
									taskId: `task_${node.id}`,
									source: "SYSTEM",
								},
								{
									clientRequestId: `req_${execId}_${node.id}`,
									tool: toolName as AiraToolId,
									action,
									input,
								},
							);

							const typedResult = toolResult as { status?: string; result?: unknown; usage?: { costUsd?: number } };
							const stepCost = typedResult.usage?.costUsd ?? 0.002;
							totalCost += stepCost;

							if (typedResult.status === "FAILED") {
								const errDetail = (typedResult.result as { error?: string })?.error ?? "Tool execution reported failure.";
								throw new Error(errDetail);
							}

							stepOutputs[node.id] = redactSecrets({
								status: "SUCCESS",
								tool: toolName,
								action,
								result: typedResult.result ?? {},
								costUsd: stepCost,
								completedAt: new Date().toISOString(),
							});
							break;
						}

						case "connector": {
							const connectorId = (node.config.connectorId as string) ?? (node.config.connector as string) ?? "unknown";
							const connectionId = (node.config.connectionId as string) ?? undefined;

							// Reject direct secrets inside workflow DAG (Blocker 4)
							if (node.config.credential || node.config.accessToken || node.config.apiKey || node.config.clientSecret) {
								throw new Error("Connector secrets must not be stored in workflow DAG. Use connectionId instead.");
							}

							const adapter = globalConnectorRegistry.getAdapter(connectorId);
							if (!adapter) {
								throw new Error(`Connector adapter '${connectorId}' not found in registry.`);
							}

							const defaultAction = adapter.actions[0]?.name ?? "list";
							const action = (node.config.action as string) ?? defaultAction;
							const params = (node.config.params as Record<string, unknown>) ?? (node.config.parameters as Record<string, unknown>) ?? {};

							// Server-side credential resolution via authenticated connection lookup
							const credential = connectionId
								? await globalConnectorCredentialStore.resolveCredentialAsync(userId, connectionId)
								: undefined;

							const actionSpec = adapter.actions.find((a) => a.name === action);
							const requiresApproval = actionSpec?.requiresApproval ?? (actionSpec?.risk === "HIGH" || actionSpec?.risk === "PROTECTED");

							if (requiresApproval) {
								if (options?.approvalId) {
									// Validate and atomically consume persisted single-use approval (Blocker 3)
									await globalAutomationApprovalStore.consumeApprovalAsync({
										approvalId: options.approvalId,
										userId,
										runId: execId,
										routineId: routine.id,
										nodeId: node.id,
										targetId: connectorId,
										action,
										parameters: params,
									});
								} else {
									// Create persisted approval record and halt workflow execution
									const approvalRecord = await globalAutomationApprovalStore.requestApprovalAsync({
										userId,
										runId: execId,
										routineId: routine.id,
										nodeId: node.id,
										targetType: "connector",
										targetId: connectorId,
										action,
										parameters: params,
										riskLevel: actionSpec?.risk ?? "HIGH",
									});

									const pendingRecord: RoutineExecutionRecord = {
										id: execId,
										routineId: routine.id,
										userId,
										status: "WAITING_APPROVAL",
										startedAt,
										stepOutputs,
										totalCostUsd: totalCost,
										pendingApprovalNodeId: node.id,
										pendingApprovalId: approvalRecord.id,
										idempotencyKey: options?.idempotencyKey,
									};
									await this.saveRunRecord(pendingRecord);

									await this.sendNotificationAsync(userId, {
										title: `Approval Required: ${routine.name}`,
										message: `High-risk action ${connectorId}.${action} reached. Confirmation required.`,
										category: "approval",
										link: `/work/routines/${routine.id}/runs/${execId}`,
									});
									return pendingRecord;
								}
							}

							let payload: Record<string, unknown>;
							if (requiresApproval) {
								payload = await adapter.executeWrite(action, params, credential);
							} else {
								payload = await adapter.executeRead(action, params, credential);
							}

							stepOutputs[node.id] = redactSecrets({
								status: "SUCCESS",
								connectorId,
								action,
								payload,
								completedAt: new Date().toISOString(),
							});
							break;
						}

						case "approval": {
							if (options?.approvalId) {
								await globalAutomationApprovalStore.consumeApprovalAsync({
									approvalId: options.approvalId,
									userId,
									runId: execId,
									routineId: routine.id,
									nodeId: node.id,
									targetId: node.id,
									action: "approval_fence",
									parameters: node.config,
								});
								stepOutputs[node.id] = {
									status: "APPROVED",
									approvalId: options.approvalId,
									approvedAt: new Date().toISOString(),
									reviewer: userId,
								};
							} else {
								const approvalRecord = await globalAutomationApprovalStore.requestApprovalAsync({
									userId,
									runId: execId,
									routineId: routine.id,
									nodeId: node.id,
									targetType: "tool",
									targetId: node.id,
									action: "approval_fence",
									parameters: node.config,
									riskLevel: "HIGH",
								});

								const pendingRecord: RoutineExecutionRecord = {
									id: execId,
									routineId: routine.id,
									userId,
									status: "WAITING_APPROVAL",
									startedAt,
									stepOutputs,
									totalCostUsd: totalCost,
									pendingApprovalNodeId: node.id,
									pendingApprovalId: approvalRecord.id,
									idempotencyKey: options?.idempotencyKey,
								};
								await this.saveRunRecord(pendingRecord);

								await this.sendNotificationAsync(userId, {
									title: `Approval Required: ${routine.name}`,
									message: (node.config.prompt as string) ?? `Approval fence reached at step ${node.name}.`,
									category: "approval",
									link: `/work/routines/${routine.id}/runs/${execId}`,
								});
								return pendingRecord;
							}
							break;
						}

						case "condition": {
							const expr = (node.config.expression as string) ?? "";
							if (!expr.trim()) {
								throw new Error(`Condition expression in step '${node.name}' cannot be empty.`);
							}
							const branchTaken = evaluateCondition(expr, { steps: stepOutputs, ...stepOutputs });
							stepOutputs[node.id] = {
								status: "EVALUATED",
								condition: expr,
								branchTaken,
								completedAt: new Date().toISOString(),
							};
							break;
						}

						case "deliverable_export": {
							const format = (node.config.format as string) ?? "MARKDOWN";
							const upstreamKeys = Object.keys(stepOutputs);
							const sections = upstreamKeys.map((k) => `### Output: ${k}\n\`\`\`json\n${JSON.stringify(stepOutputs[k], null, 2)}\n\`\`\``).join("\n\n");
							const deliverableContent = `# ${routine.name} Final Deliverable\n\nGenerated for user ${userId} on ${new Date().toISOString()}\n\n## Verified Execution Traces\n\n${sections}`;

							// Canonical Async Artifact Creation (Blocker 7)
							const artifact = await globalArtifactEngine.createArtifactAsync({
								userId,
								name: `${routine.name} Deliverable.${format.toLowerCase()}`,
								format: format === "CSV" ? "CSV" : format === "PDF" ? "PDF" : format === "DOCX" ? "DOCX" : format === "XLSX" ? "XLSX" : format === "PPTX" ? "PPTX" : "MARKDOWN",
								content: deliverableContent,
								provenance: {
									runId: execId,
									generator: "AutomationEngine",
									inputChecksum: createHash("sha256").update(JSON.stringify(stepOutputs)).digest("hex"),
								},
							});

							stepOutputs[node.id] = redactSecrets({
								status: "EXPORTED",
								artifactId: artifact.id,
								format,
								checksum: artifact.versions[0]?.checksum,
								sizeBytes: artifact.versions[0]?.sizeBytes,
								completedAt: new Date().toISOString(),
							});
							break;
						}
					}
				} catch (stepErr: unknown) {
					// Failure semantics enforcement (Blocker 2)
					const normalizedError = {
						message: stepErr instanceof Error ? stepErr.message : String(stepErr),
						code: (stepErr as { code?: string })?.code ?? "STEP_FAILED",
						retryable: Boolean((stepErr as { retryable?: boolean })?.retryable),
					};

					stepOutputs[node.id] = redactSecrets({
						status: "FAILED",
						failedNodeId: node.id,
						normalizedError,
						retryability: normalizedError.retryable,
						attempt: 1,
						timestamp: new Date().toISOString(),
						policy: failurePolicy,
					});

					if (failurePolicy === "FAIL_WORKFLOW") {
						const failedRecord: RoutineExecutionRecord = {
							id: execId,
							routineId: routine.id,
							userId,
							status: "FAILED",
							startedAt,
							completedAt: new Date().toISOString(),
							stepOutputs,
							totalCostUsd: totalCost,
							error: `Step '${node.name}' (${node.id}) failed: ${normalizedError.message}`,
							failedNodeId: node.id,
							idempotencyKey: options?.idempotencyKey,
						};
						await this.saveRunRecord(failedRecord);
						return failedRecord;
					}
				}

				// Checkpoint run state after each node execution
				await this.saveRunRecord({
					id: execId,
					routineId: routine.id,
					userId,
					status: "RUNNING",
					startedAt,
					stepOutputs,
					totalCostUsd: totalCost,
					idempotencyKey: options?.idempotencyKey,
				});
			}

			const record: RoutineExecutionRecord = {
				id: execId,
				routineId: routine.id,
				userId,
				status: "COMPLETED",
				startedAt,
				completedAt: new Date().toISOString(),
				stepOutputs,
				totalCostUsd: totalCost,
				idempotencyKey: options?.idempotencyKey,
			};

			await this.saveRunRecord(record);

			await this.sendNotificationAsync(userId, {
				title: `Routine Completed: ${routine.name}`,
				message: `Automated routine finished all ${order.length} workflow steps.`,
				category: "routine",
				link: `/work/routines/${routine.id}/runs/${execId}`,
			});

			return record;
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			const failedRecord: RoutineExecutionRecord = {
				id: execId,
				routineId: routine.id,
				userId,
				status: "FAILED",
				startedAt,
				completedAt: new Date().toISOString(),
				stepOutputs,
				totalCostUsd: totalCost,
				error: errorMsg,
				idempotencyKey: options?.idempotencyKey,
			};
			await this.saveRunRecord(failedRecord);
			throw err;
		}
	}

	// Notifications / Autonomous Work Inbox (Gate 109)
	async sendNotificationAsync(userId: string, input: {
		title: string;
		message: string;
		category: NotificationItem["category"];
		link?: string;
	}): Promise<NotificationItem> {
		const item: NotificationItem = {
			id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			userId,
			title: input.title,
			message: input.message,
			category: input.category,
			read: false,
			link: input.link,
			createdAt: new Date().toISOString(),
		};

		if (process.env.DATABASE_URL) {
			await prisma.automationNotification.create({
				data: {
					id: item.id,
					userId: item.userId,
					title: item.title,
					message: item.message,
					category: item.category,
					read: item.read,
					link: item.link ?? null,
				},
			});
		}

		const list = this.notifications.get(userId) ?? [];
		list.unshift(item);
		this.notifications.set(userId, list);
		this.persistToDisk();

		return item;
	}

	sendNotification(userId: string, input: {
		title: string;
		message: string;
		category: NotificationItem["category"];
		link?: string;
	}): NotificationItem {
		const item: NotificationItem = {
			id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			userId,
			title: input.title,
			message: input.message,
			category: input.category,
			read: false,
			link: input.link,
			createdAt: new Date().toISOString(),
		};

		const list = this.notifications.get(userId) ?? [];
		list.unshift(item);
		this.notifications.set(userId, list);
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.automationNotification.create({
				data: {
					id: item.id,
					userId: item.userId,
					title: item.title,
					message: item.message,
					category: item.category,
					read: item.read,
					link: item.link ?? null,
				},
			});
		}

		return item;
	}

	async getUserNotificationsAsync(userId: string): Promise<readonly NotificationItem[]> {
		if (process.env.DATABASE_URL) {
			const dbList = await prisma.automationNotification.findMany({
				where: { userId },
				orderBy: { createdAt: "desc" },
			});
			return dbList.map((n) => ({
				id: n.id,
				userId: n.userId,
				title: n.title,
				message: n.message,
				category: n.category as NotificationItem["category"],
				read: n.read,
				link: n.link ?? undefined,
				createdAt: n.createdAt.toISOString(),
			}));
		}
		return this.notifications.get(userId) ?? [];
	}

	getUserNotifications(userId: string): readonly NotificationItem[] {
		return this.notifications.get(userId) ?? [];
	}

	async markNotificationReadAsync(userId: string, notifId: string): Promise<boolean> {
		if (process.env.DATABASE_URL) {
			const updated = await prisma.automationNotification.update({
				where: { id: notifId },
				data: { read: true },
			});
			if (updated) {
				const list = this.notifications.get(userId);
				const target = list?.find((n) => n.id === notifId);
				if (target) (target as { read: boolean }).read = true;
				return true;
			}
		}
		return this.markNotificationRead(userId, notifId);
	}

	markNotificationRead(userId: string, notifId: string): boolean {
		const list = this.notifications.get(userId);
		if (!list) return false;
		const target = list.find((n) => n.id === notifId);
		if (!target) return false;
		(target as { read: boolean }).read = true;
		this.persistToDisk();

		if (process.env.DATABASE_URL) {
			void prisma.automationNotification.update({
				where: { id: notifId },
				data: { read: true },
			});
		}
		return true;
	}

	// Durability restart helper
	reloadFromDisk(): void {
		this.routines.clear();
		this.executionHistory = [];
		this.notifications.clear();
		this.loadFromDisk();
	}
}

export const globalAutomationEngine = new AutomationEngine();

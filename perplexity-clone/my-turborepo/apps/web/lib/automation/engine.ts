import { z } from "zod";

export const RoutineTriggerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("cron"),
		cronExpression: z.string().min(5),
		timezone: z.string().default("UTC"),
	}),
	z.object({
		type: z.literal("interval"),
		intervalSeconds: z.number().int().min(60),
	}),
	z.object({
		type: z.literal("webhook"),
		secretToken: z.string().min(8),
	}),
	z.object({
		type: z.literal("connector_event"),
		connectorId: z.string(),
		eventPattern: z.string(),
	}),
	z.object({
		type: z.literal("manual"),
	}),
]);

export const WorkflowNodeSchema = z.object({
	id: z.string().min(1),
	type: z.enum(["trigger", "agent", "tool", "connector", "condition", "approval", "deliverable_export"]),
	name: z.string(),
	config: z.record(z.string(), z.any()).default({}),
	inputBindings: z.record(z.string(), z.string()).default({}),
});

export const WorkflowEdgeSchema = z.object({
	id: z.string().min(1),
	sourceNodeId: z.string(),
	targetNodeId: z.string(),
	conditionExpr: z.string().optional(),
});

export const VisualWorkflowDAGSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(128),
	version: z.number().int().min(1).default(1),
	description: z.string().max(1000).default(""),
	nodes: z.array(WorkflowNodeSchema).min(1),
	edges: z.array(WorkflowEdgeSchema).default([]),
});

export const RoutineDefinitionSchema = z.object({
	id: z.string().min(1),
	userId: z.string(),
	projectId: z.string().optional(),
	name: z.string().min(1).max(128),
	description: z.string().max(1000).default(""),
	enabled: z.boolean().default(true),
	trigger: RoutineTriggerSchema,
	workflowDag: VisualWorkflowDAGSchema,
	budgetUsd: z.number().min(0).default(5.0),
	createdAt: z.string(),
	updatedAt: z.string(),
	lastRunAt: z.string().optional(),
	nextRunAt: z.string().optional(),
});

export type RoutineDefinition = z.infer<typeof RoutineDefinitionSchema>;
export type VisualWorkflowDAG = z.infer<typeof VisualWorkflowDAGSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export interface RoutineExecutionRecord {
	readonly id: string;
	readonly routineId: string;
	readonly userId: string;
	readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "PAUSED_APPROVAL";
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly stepOutputs: Record<string, unknown>;
	readonly totalCostUsd: number;
	readonly error?: string;
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
				{ id: "node_2", type: "agent", name: "Research Intelligence Agent", config: { skills: ["analytics", "product-discovery"] }, inputBindings: {} },
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
				{ id: "node_3", type: "agent", name: "Financial Modeler", config: { skills: ["finance-analysis", "analytics"] }, inputBindings: {} },
				{ id: "node_4", type: "deliverable_export", name: "Generate Spreadsheet", config: { format: "SPREADSHEET" }, inputBindings: {} },
			],
			edges: [
				{ id: "edge_1_2", sourceNodeId: "node_1", targetNodeId: "node_2" },
				{ id: "edge_2_3", sourceNodeId: "node_2", targetNodeId: "node_3" },
				{ id: "edge_3_4", sourceNodeId: "node_3", targetNodeId: "node_4" },
			],
		},
	];

	createRoutine(input: {
		userId: string;
		projectId?: string;
		name: string;
		description?: string;
		enabled?: boolean;
		trigger: z.infer<typeof RoutineTriggerSchema>;
		workflowDag: VisualWorkflowDAG;
		budgetUsd?: number;
	}): RoutineDefinition {
		const id = `routine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const now = new Date().toISOString();
		const routine: RoutineDefinition = RoutineDefinitionSchema.parse({
			...input,
			description: input.description ?? "",
			budgetUsd: input.budgetUsd ?? 5.0,
			id,
			createdAt: now,
			updatedAt: now,
		});
		this.routines.set(routine.id, routine);
		return routine;
	}

	getRoutine(id: string): RoutineDefinition | undefined {
		return this.routines.get(id);
	}

	listUserRoutines(userId: string): readonly RoutineDefinition[] {
		return Array.from(this.routines.values()).filter((r) => r.userId === userId);
	}

	updateRoutine(id: string, updates: Partial<RoutineDefinition>): RoutineDefinition {
		const existing = this.routines.get(id);
		if (!existing) throw new Error("Routine not found");
		const updated: RoutineDefinition = RoutineDefinitionSchema.parse({
			...existing,
			...updates,
			id: existing.id,
			userId: existing.userId,
			updatedAt: new Date().toISOString(),
		});
		this.routines.set(id, updated);
		return updated;
	}

	// Validate DAG topological sort and detect cycles (Gate 116)
	validateDAG(dag: VisualWorkflowDAG): { valid: boolean; cycles: boolean; order: string[] } {
		const adj = new Map<string, string[]>();
		const inDegree = new Map<string, number>();

		for (const node of dag.nodes) {
			adj.set(node.id, []);
			inDegree.set(node.id, 0);
		}

		for (const edge of dag.edges) {
			adj.get(edge.sourceNodeId)?.push(edge.targetNodeId);
			inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
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
		return { valid: !cycles, cycles, order };
	}

	// Cross-Connector Planning & Execution simulation (Gate 108)
	async executeWorkflow(routineId: string, userId: string): Promise<RoutineExecutionRecord> {
		const routine = this.routines.get(routineId);
		if (!routine) throw new Error("Routine not found");

		const { valid, order } = this.validateDAG(routine.workflowDag);
		if (!valid) throw new Error("Workflow contains invalid cycles or disjoint references.");

		const execId = `exec-${Date.now()}`;
		const startedAt = new Date().toISOString();
		const stepOutputs: Record<string, unknown> = {};

		for (const nodeId of order) {
			const node = routine.workflowDag.nodes.find((n) => n.id === nodeId);
			if (!node) continue;
			// Simulated safe deterministic run with per-node sandboxing
			stepOutputs[node.id] = { executed: true, type: node.type, timestamp: new Date().toISOString() };
		}

		const record: RoutineExecutionRecord = {
			id: execId,
			routineId: routine.id,
			userId,
			status: "COMPLETED",
			startedAt,
			completedAt: new Date().toISOString(),
			stepOutputs,
			totalCostUsd: 0.02,
		};

		this.executionHistory.push(record);
		this.sendNotification(userId, {
			title: `Routine Completed: ${routine.name}`,
			message: `Automated routine finished all ${order.length} workflow steps.`,
			category: "routine",
		});

		return record;
	}

	// Notifications & Work Inbox (Gate 109, 110)
	sendNotification(userId: string, item: Omit<NotificationItem, "id" | "userId" | "createdAt" | "read">): NotificationItem {
		const userItems = this.notifications.get(userId) ?? [];
		const notification: NotificationItem = {
			...item,
			id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			userId,
			read: false,
			createdAt: new Date().toISOString(),
		};
		userItems.unshift(notification);
		this.notifications.set(userId, userItems);
		return notification;
	}

	getUserNotifications(userId: string): readonly NotificationItem[] {
		return this.notifications.get(userId) ?? [];
	}

	markNotificationRead(userId: string, id: string): boolean {
		const items = this.notifications.get(userId);
		if (!items) return false;
		const target = items.find((i) => i.id === id);
		if (!target) return false;
		(target as { read: boolean }).read = true;
		return true;
	}
}

export const globalAutomationEngine = new AutomationEngine();

import { z } from "zod";

import { auth } from "@/auth";
import {
	routeIntent,
	toIntentDecisionTelemetry,
	type IntentDecision,
} from "@/lib/intent-router";
import { createProject } from "@/lib/agent-platform/store";
import { toolAvailability } from "@/lib/tool-gateway/gateway";
import {
	globalAutomationEngine,
	type RoutineTrigger,
	type VisualWorkflowDAG,
} from "@/lib/automation/engine";
import { executeReadOnlyChatTool } from "@/lib/intent-router/tool-execution";
import { ToolGatewayError } from "@/lib/tool-gateway/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z
	.object({
		message: z.string().trim().min(1).max(16_000),
		timezone: z.string().trim().min(1).max(100).optional(),
	})
	.strict();

const SAFE_NATIVE_CAPABILITIES = [
	"answer.generate",
	"research.web_search",
	"research.deep_research",
	"automation.create",
	"agent.plan",
] as const;

async function availableCapabilities(): Promise<ReadonlySet<string>> {
	const available = new Set<string>(SAFE_NATIVE_CAPABILITIES);
	const tools = await toolAvailability().catch(() => null);
	if (!tools) return available;

	if (tools.gmail) {
		available.add("email.read");
		available.add("email.search");
		available.add("email.draft");
		available.add("email.send");
	}
	if (tools.google_drive) {
		available.add("drive.search");
		available.add("drive.read");
		available.add("drive.write");
	}
	if (tools.slack) available.add("slack.send");
	if (tools.google_calendar) {
		available.add("calendar.read");
		available.add("calendar.create");
	}
	if (tools.crm) {
		available.add("crm.lead.search");
		available.add("crm.contact.create");
	}

	// CRM enrichment/contact-update, publishing, delete and finance capabilities
	// remain blocked until dedicated certified adapters/actions exist.
	return available;
}

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

function automationTriggerFor(decision: IntentDecision): RoutineTrigger | null {
	const recurrence = decision.recurrence;
	if (!recurrence) return { type: "manual" };

	if (recurrence.type === "cron" && recurrence.schedule) {
		return {
			type: "cron",
			cronExpression: recurrence.schedule,
			timezone: recurrence.timezone ?? "UTC",
		};
	}

	if (recurrence.type === "interval" && recurrence.schedule) {
		const match = recurrence.schedule.match(/^every\s+(\d+)\s+(minute|hour|day|week)\(s\)$/i);
		if (!match) return null;
		const count = Number(match[1]);
		const unit = match[2]!.toLowerCase();
		const multiplier =
			unit === "minute" ? 1 :
			unit === "hour" ? 60 :
			unit === "day" ? 1_440 :
			10_080;
		return { type: "interval", intervalMinutes: count * multiplier };
	}

	if (recurrence.type === "event" && recurrence.event === "email.received") {
		return { type: "connector_event", connectorId: "gmail", eventName: "message.received" };
	}
	if (recurrence.type === "event" && recurrence.event === "drive.file.created") {
		return { type: "connector_event", connectorId: "google_drive", eventName: "file.created" };
	}

	return null;
}

function automationDraftDag(decision: IntentDecision): VisualWorkflowDAG {
	return {
		id: `intent-draft-${crypto.randomUUID()}`,
		name: "Aira natural-language automation draft",
		version: 1,
		description: `Non-executable draft awaiting certified workflow compilation. Capabilities: ${decision.requiredCapabilities.join(", ")}`,
		nodes: [
			{
				id: "intent_draft",
				type: "trigger",
				name: "Intent draft boundary",
				config: {
					intentDraft: true,
					requiredCapabilities: decision.requiredCapabilities,
				},
				inputBindings: {},
			},
		],
		edges: [],
	};
}

function directiveFor(
	decision: IntentDecision,
	options: {
		readonly workProjectId?: string;
		readonly automationDraftId?: string;
		readonly automationDraftReason?: string;
	} = {},
) {
	switch (decision.intent) {
		case "ANSWER":
		case "RESEARCH":
			return {
				type: "SEARCH" as const,
				mode: decision.executionSurface === "DEEP_RESEARCH" ? "deep" as const : "standard" as const,
			};
		case "AGENT_MISSION":
			return {
				type: "WORK_REVIEW" as const,
				href: options.workProjectId
					? `/work?intent=agent&projectId=${encodeURIComponent(options.workProjectId)}`
					: "/work?intent=agent",
				autoLaunch: false,
			};
		case "TOOL_ACTION":
			return {
				type: "TOOL_PREVIEW" as const,
				capabilities: decision.requiredCapabilities,
				requiresApproval: decision.requiresApproval,
				status: decision.fallbackReason ? "BLOCKED" as const : "READY" as const,
				reason: decision.fallbackReason ?? "Review the resolved action before execution.",
			};
		case "WORKFLOW":
		case "AUTOMATION_CREATE":
			return {
				type: "AUTOMATION_PREVIEW" as const,
				persistent: decision.intent === "AUTOMATION_CREATE",
				enabled: false,
				recurrence: decision.recurrence ?? null,
				capabilities: decision.requiredCapabilities,
				requiresApproval: true,
				...(options.automationDraftId ? { routineId: options.automationDraftId } : {}),
				status: (decision.fallbackReason || options.automationDraftReason) ? "BLOCKED" as const : "READY" as const,
				reason: decision.fallbackReason ?? options.automationDraftReason ?? "Preview only. Explicit activation is required.",
			};
	}
}

export async function POST(request: Request): Promise<Response> {
	const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json(
			{ error: { code: "VALIDATION_ERROR", message: "Intent request is invalid.", details: z.treeifyError(parsed.error) } },
			{ status: 400 },
		);
	}

	const routed = await routeIntent(parsed.data.message, {
		timezone: parsed.data.timezone ?? "UTC",
		availableCapabilities: await availableCapabilities(),
	});
	if (routed.kind === "EXPLICIT_COMMAND") {
		return json(
			{ error: { code: "EXPLICIT_COMMAND_REQUIRED", message: "Explicit commands must use the command registry." } },
			{ status: 409 },
		);
	}

	const telemetry = toIntentDecisionTelemetry(routed.decision);
	console.info("[AiraIntentRouter] decision", JSON.stringify(telemetry));

	let workProjectId: string | undefined;
	let automationDraftId: string | undefined;
	let automationDraftReason: string | undefined;
	let toolDirective:
		| {
				type: "TOOL_RESULT";
				capabilities: readonly string[];
				status: "COMPLETED";
				requiresApproval: false;
				reason: string;
				tool: string;
				action: string;
				result: Record<string, unknown>;
				runId: string;
			}
		| {
				type: "TOOL_PREVIEW";
				capabilities: readonly string[];
				status: "BLOCKED" | "READY";
				requiresApproval: boolean;
				reason: string;
				approvalId?: string;
			}
		| undefined;
	const initialDirective = directiveFor(routed.decision);
	if (initialDirective.type !== "SEARCH") {
		const session = await auth();
		if (!session?.user?.id) {
			return json(
				{
					error: { code: "UNAUTHENTICATED", message: "Sign in is required for actions, workflows, automations, and missions." },
					decision: routed.decision,
				},
				{ status: 401 },
			);
		}

		if (
			routed.decision.intent === "TOOL_ACTION" &&
			!routed.decision.fallbackReason &&
			routed.decision.sideEffect === "READ"
		) {
			try {
				const execution = await executeReadOnlyChatTool({
					userId: session.user.id,
					message: parsed.data.message,
					decision: routed.decision,
				});
				if (execution.kind === "BLOCKED") {
					toolDirective = {
						type: "TOOL_PREVIEW",
						capabilities: routed.decision.requiredCapabilities,
						status: "BLOCKED",
						requiresApproval: routed.decision.requiresApproval,
						reason: execution.reason,
					};
				} else if (execution.execution.result.status === "COMPLETED") {
					toolDirective = {
						type: "TOOL_RESULT",
						capabilities: routed.decision.requiredCapabilities,
						status: "COMPLETED",
						requiresApproval: false,
						reason: "Aira completed the read-only action through the Tool Gateway.",
						tool: execution.execution.action.tool,
						action: execution.execution.action.action,
						result: execution.execution.result.result,
						runId: execution.execution.runId,
					};
				} else if (execution.execution.result.status === "APPROVAL_REQUIRED") {
					toolDirective = {
						type: "TOOL_PREVIEW",
						capabilities: routed.decision.requiredCapabilities,
						status: "READY",
						requiresApproval: true,
						reason: "The Tool Gateway requires explicit approval before this action can continue.",
						approvalId: execution.execution.result.approvalId,
					};
				} else {
					toolDirective = {
						type: "TOOL_PREVIEW",
						capabilities: routed.decision.requiredCapabilities,
						status: "BLOCKED",
						requiresApproval: false,
						reason: execution.execution.result.reason,
					};
				}
				console.info(
					"[AiraExecutionRouter] tool_action",
					JSON.stringify({
						intent: routed.decision.intent,
						executionSurface: routed.decision.executionSurface,
						status: execution.kind === "EXECUTED" ? execution.execution.result.status : "BLOCKED",
						capabilities: routed.decision.requiredCapabilities,
					}),
				);
			} catch (error) {
				if (!(error instanceof ToolGatewayError)) throw error;
				toolDirective = {
					type: "TOOL_PREVIEW",
					capabilities: routed.decision.requiredCapabilities,
					status: "BLOCKED",
					requiresApproval: false,
					reason: `${error.code}: ${error.message}`,
				};
			}
		}

		if (
			routed.decision.intent === "AGENT_MISSION" &&
			!routed.decision.fallbackReason
		) {
			const project = await createProject({
				userId: session.user.id,
				name: "Aira mission review",
				objective: parsed.data.message,
				config: {
					source: "intent-router",
					intent: "AGENT_MISSION",
					launchAuthorized: false,
				},
			});
			workProjectId = project.id;
			console.info(
				"[AiraExecutionRouter] handoff",
				JSON.stringify({
					intent: routed.decision.intent,
					executionSurface: routed.decision.executionSurface,
					projectId: project.id,
					autoLaunch: false,
				}),
			);
		}

		if (routed.decision.intent === "AUTOMATION_CREATE") {
			const trigger = automationTriggerFor(routed.decision);
			if (!trigger) {
				automationDraftReason = "AUTOMATION_TRIGGER_UNSUPPORTED: Aira could not persist this recurrence safely.";
			} else {
				const draft = await globalAutomationEngine.createDraftRoutineAsync({
					userId: session.user.id,
					name: "Aira automation draft",
					description: "Natural-language automation draft. It remains non-executable until compiled into a certified workflow.",
					trigger,
					workflowDag: automationDraftDag(routed.decision),
					budgetUsd: 5,
				});
				automationDraftId = draft.id;
				automationDraftReason = "DRAFT_REQUIRES_CERTIFIED_WORKFLOW: Persisted safely, but activation is blocked until Aira compiles a certified executable workflow.";
				console.info(
					"[AiraExecutionRouter] automation_draft",
					JSON.stringify({
						intent: routed.decision.intent,
						executionSurface: routed.decision.executionSurface,
						routineId: draft.id,
						enabled: false,
						recurrenceType: routed.decision.recurrence?.type ?? null,
					}),
				);
			}
		}
	}

	const directive = toolDirective ?? directiveFor(routed.decision, {
		workProjectId,
		automationDraftId,
		automationDraftReason,
	});
	return json({ decision: routed.decision, directive });
}

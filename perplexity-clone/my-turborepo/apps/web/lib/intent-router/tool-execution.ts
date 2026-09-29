import { randomUUID } from "node:crypto";

import {
	archiveProjectForUser,
	createPlatformRun,
	createProject,
	setRunStatus,
} from "@/lib/agent-platform/store";
import type { RunBudgets } from "@/lib/agent-platform/types";
import { executeTool } from "@/lib/tool-gateway/gateway";
import type {
	AiraToolId,
	ToolExecutionResult,
} from "@/lib/tool-gateway/types";

import type { IntentDecision } from "./contract";

export interface ResolvedReadOnlyToolAction {
	readonly capability: string;
	readonly tool: AiraToolId;
	readonly action: string;
	readonly input: Record<string, unknown>;
}

export type ReadOnlyToolResolution =
	| { readonly kind: "READY"; readonly action: ResolvedReadOnlyToolAction }
	| { readonly kind: "BLOCKED"; readonly reason: string };

export interface ChatToolExecution {
	readonly projectId: string;
	readonly runId: string;
	readonly action: ResolvedReadOnlyToolAction;
	readonly result: ToolExecutionResult;
}

const CHAT_TOOL_BUDGETS: RunBudgets = {
	maxAgents: 1,
	maxParallelAgents: 1,
	maxToolCalls: 1,
	maxTokens: 2_000,
	maxCostUsd: 0.25,
	maxDurationMinutes: 5,
	maxRetries: 0,
};

function gmailQuery(message: string): string | undefined {
	const normalized = message.toLowerCase();
	const parts: string[] = [];
	if (/\bimportant\b/.test(normalized)) parts.push("is:important");
	if (/\bunread\b/.test(normalized)) parts.push("is:unread");

	const fromEmail = message.match(/\bfrom\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)?.[1];
	if (fromEmail) parts.push(`from:${fromEmail}`);

	const subject = message.match(/\bsubject\s+(?:contains?|matching)\s+["']?([^"']{1,120})["']?/i)?.[1]?.trim();
	if (subject) parts.push(`subject:${subject}`);

	return parts.length > 0 ? parts.join(" ") : undefined;
}

function driveSearchQuery(message: string): string | undefined {
	const quoted = message.match(/["']([^"']{1,120})["']/)?.[1]?.trim();
	let term = quoted;

	if (!term) {
		const match = message.match(
			/\b(?:find|search(?:\s+for)?|locate)\s+(?:my\s+|the\s+)?(?:latest\s+|recent\s+)?(.+?)\s+(?:in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/i,
		);
		term = match?.[1]?.trim();
	}

	if (!term) return undefined;
	term = term
		.replace(/\b(?:file|document|doc|files|documents)\b/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!term) return undefined;

	const bounded = term.slice(0, 100).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	return `name contains '${bounded}'`;
}

export function resolveReadOnlyToolAction(
	message: string,
	decision: IntentDecision,
): ReadOnlyToolResolution {
	if (decision.intent !== "TOOL_ACTION") {
		return { kind: "BLOCKED", reason: "TOOL_INTENT_REQUIRED" };
	}
	if (decision.sideEffect !== "READ" || decision.requiresApproval) {
		return {
			kind: "BLOCKED",
			reason: "TOOL_ACTION_REQUIRES_REVIEW: only read-only actions auto-execute from chat.",
		};
	}
	if (decision.requiredCapabilities.length !== 1) {
		return {
			kind: "BLOCKED",
			reason: "TOOL_ACTION_AMBIGUOUS: a single certified read capability is required.",
		};
	}

	const capability = decision.requiredCapabilities[0]!;
	if (capability === "email.read" || capability === "email.search") {
		const q = gmailQuery(message);
		return {
			kind: "READY",
			action: {
				capability,
				tool: "gmail",
				action: q ? "search" : "list_messages",
				input: q ? { q, maxResults: 20 } : { maxResults: 20 },
			},
		};
	}

	if (capability === "drive.search") {
		const q = driveSearchQuery(message);
		if (!q) {
			return {
				kind: "BLOCKED",
				reason: "TOOL_INPUT_REQUIRED: specify what file to find in Drive.",
			};
		}
		return {
			kind: "READY",
			action: {
				capability,
				tool: "google_drive",
				action: "search",
				input: { q, pageSize: 20 },
			},
		};
	}

	return {
		kind: "BLOCKED",
		reason: `TOOL_ACTION_UNSUPPORTED: ${capability} has no certified natural-language executor.`,
	};
}

export async function executeReadOnlyChatTool(input: {
	readonly userId: string;
	readonly message: string;
	readonly decision: IntentDecision;
}): Promise<
	| { readonly kind: "BLOCKED"; readonly reason: string }
	| { readonly kind: "EXECUTED"; readonly execution: ChatToolExecution }
> {
	const resolved = resolveReadOnlyToolAction(input.message, input.decision);
	if (resolved.kind === "BLOCKED") return resolved;

	const project = await createProject({
		userId: input.userId,
		name: "Aira chat action",
		objective: "Bounded user-requested chat tool action.",
		config: {
			source: "intent-router",
			hidden: true,
			capability: resolved.action.capability,
		},
	});

	const archived = await archiveProjectForUser(input.userId, project.id);
	if (!archived) {
		throw new Error("Unable to hide chat action execution project.");
	}

	const run = await createPlatformRun({
		userId: input.userId,
		projectId: project.id,
		clientRequestId: `chat-tool-${randomUUID()}`,
		runtime: null,
		budgets: CHAT_TOOL_BUDGETS,
		tasks: [],
	});

	try {
		const result = await executeTool(
			{
				userId: input.userId,
				projectId: project.id,
				runId: run.id,
				taskId: null,
				agentId: null,
				source: "USER",
			},
			{
				clientRequestId: `tool-${randomUUID()}`,
				tool: resolved.action.tool,
				action: resolved.action.action,
				input: resolved.action.input,
			},
		);

		const status =
			result.status === "COMPLETED"
				? "COMPLETED"
				: result.status === "APPROVAL_REQUIRED"
					? "APPROVAL_REQUIRED"
					: "BLOCKED";
		await setRunStatus(run.id, status, `Chat tool action: ${resolved.action.capability}`);

		return {
			kind: "EXECUTED",
			execution: {
				projectId: project.id,
				runId: run.id,
				action: resolved.action,
				result,
			},
		};
	} catch (error) {
		await setRunStatus(
			run.id,
			"FAILED",
			error instanceof Error ? error.message.slice(0, 500) : "Chat tool action failed.",
		).catch(() => undefined);
		throw error;
	}
}

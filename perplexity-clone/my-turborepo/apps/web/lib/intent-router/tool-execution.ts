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

function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const value = (type: "year" | "month" | "day") =>
		Number(parts.find((part) => part.type === type)?.value);
	return { year: value("year"), month: value("month"), day: value("day") };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(
		pick("year"),
		pick("month") - 1,
		pick("day"),
		pick("hour"),
		pick("minute"),
		pick("second"),
	);
	return asUtc - Math.floor(date.getTime() / 1_000) * 1_000;
}

function zonedMidnightUtc(
	date: { year: number; month: number; day: number },
	timeZone: string,
): Date {
	const nominal = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
	let candidate = nominal - timeZoneOffsetMs(new Date(nominal), timeZone);
	candidate = nominal - timeZoneOffsetMs(new Date(candidate), timeZone);
	return new Date(candidate);
}

function addCalendarDays(
	date: { year: number; month: number; day: number },
	days: number,
): { year: number; month: number; day: number } {
	const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0));
	return {
		year: next.getUTCFullYear(),
		month: next.getUTCMonth() + 1,
		day: next.getUTCDate(),
	};
}

function calendarReadWindow(message: string, timeZone: string): { timeMin: string; timeMax: string } {
	const now = new Date();
	const localToday = zonedDateParts(now, timeZone);
	if (/\btomorrow\b/i.test(message)) {
		const startDate = addCalendarDays(localToday, 1);
		const endDate = addCalendarDays(localToday, 2);
		return {
			timeMin: zonedMidnightUtc(startDate, timeZone).toISOString(),
			timeMax: zonedMidnightUtc(endDate, timeZone).toISOString(),
		};
	}
	if (/\btoday\b/i.test(message)) {
		const endDate = addCalendarDays(localToday, 1);
		return {
			timeMin: now.toISOString(),
			timeMax: zonedMidnightUtc(endDate, timeZone).toISOString(),
		};
	}
	return {
		timeMin: now.toISOString(),
		timeMax: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
	};
}

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
	timeZone = "UTC",
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

	if (capability === "calendar.read") {
		const safeTimeZone = (() => {
			try {
				new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
				return timeZone;
			} catch {
				return "UTC";
			}
		})();
		return {
			kind: "READY",
			action: {
				capability,
				tool: "google_calendar",
				action: "list_events",
				input: { ...calendarReadWindow(message, safeTimeZone), calendarId: "primary" },
			},
		};
	}

	if (capability === "crm.lead.search") {
		const match = message.match(
			/\b(?:find|search(?:\s+for)?|list)\s+(?:new\s+)?(.+?)\s+(?:in|from)\s+(?:the\s+)?(?:crm|hubspot)\b/i,
		);
		const rawQuery = match?.[1]
			?.replace(/\b(?:leads?|prospects?|contacts?)\b/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
		return {
			kind: "READY",
			action: {
				capability,
				tool: "crm",
				action: "search_contacts",
				input: rawQuery ? { query: rawQuery.slice(0, 200), limit: 20 } : { limit: 20 },
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
	readonly timeZone?: string;
}): Promise<
	| { readonly kind: "BLOCKED"; readonly reason: string }
	| { readonly kind: "EXECUTED"; readonly execution: ChatToolExecution }
> {
	const resolved = resolveReadOnlyToolAction(input.message, input.decision, input.timeZone ?? "UTC");
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

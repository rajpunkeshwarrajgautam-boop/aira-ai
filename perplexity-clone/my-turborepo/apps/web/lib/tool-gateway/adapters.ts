import { z } from "zod";

import {
	getBrowserSession,
	recordBrowserAction,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import {
	createWorktreeRecord,
	getWorktreeForUser,
	updateWorktreeStatus,
} from "@/lib/agent-platform/worktrees";
import {
	browserRuntimeHealth,
	runRemoteBrowserAction,
} from "@/lib/browser-runtime/client";
import {
	closeRemoteWorkspace,
	commitRemoteWorkspace,
	createRemoteWorkspace,
	getRemoteWorkspace,
	getRemoteWorkspaceDiff,
	mergeRemoteWorkspace,
	runRemoteCommand,
	terminalRuntimeHealth,
} from "@/lib/terminal-runtime/client";

import type { ToolAdapter } from "./types";
import { ToolGatewayError } from "./types";

const BrowserInputSchema = z.object({
	sessionId: z.string().min(8).max(128),
	selector: z.string().max(2048).optional(),
	text: z.string().max(20_000).optional(),
	value: z.string().max(4096).optional(),
	key: z.string().max(128).optional(),
	url: z.string().url().max(4096).optional(),
	x: z.number().min(0).max(4096).optional(),
	y: z.number().min(0).max(4096).optional(),
	deltaY: z.number().min(-10_000).max(10_000).optional(),
	milliseconds: z.number().int().min(0).max(10_000).optional(),
});

const TerminalExecSchema = z.object({
	workspaceId: z.string().min(8).max(128),
	argv: z.array(z.string().min(1).max(4096)).min(1).max(64),
	cwd: z.string().max(1024).optional(),
	timeoutSeconds: z.number().int().min(1).max(900).optional(),
});

const CreateWorktreeSchema = z.object({
	repositoryUrl: z.string().url().max(2048),
	baseRef: z.string().min(1).max(192).default("main"),
});

const WorkspaceSchema = z.object({ workspaceId: z.string().min(8).max(128) });
const CommitSchema = WorkspaceSchema.extend({ message: z.string().trim().min(1).max(500) });
const MergeSchema = z.object({ targetWorkspaceId: z.string().min(8).max(128), sourceWorkspaceId: z.string().min(8).max(128) });

function invalidInput(message: string): never {
	throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message, status: 400 });
}

async function ownedWorktree(userId: string, runId: string, workspaceId: string) {
	const record = await getWorktreeForUser(userId, workspaceId);
	if (!record || record.runId !== runId) {
		throw new ToolGatewayError({ code: "WORKTREE_NOT_FOUND", message: "Worktree not found in this mission.", status: 404 });
	}
	return record;
}

export const browserToolAdapter: ToolAdapter = {
	id: "browser",
	isAvailable: browserRuntimeHealth,
	async execute(context, action, input) {
		const parsed = BrowserInputSchema.safeParse(input);
		if (!parsed.success) invalidInput("Browser action input is invalid.");
		const session = await getBrowserSession(context.userId, parsed.data.sessionId);
		if (!session || (session.runId && session.runId !== context.runId) || (session.projectId && session.projectId !== context.projectId)) {
			throw new ToolGatewayError({ code: "BROWSER_SESSION_FORBIDDEN", message: "Browser session is outside this mission scope.", status: 403 });
		}
		if (session.expiresAt.getTime() <= Date.now()) {
			await updateBrowserSession({ sessionId: session.id, status: "EXPIRED" });
			throw new ToolGatewayError({ code: "BROWSER_SESSION_EXPIRED", message: "Browser session expired.", status: 410 });
		}
		if (["PAUSED", "ENDED", "FAILED", "EXPIRED"].includes(session.status)) {
			throw new ToolGatewayError({ code: "BROWSER_SESSION_NOT_ACTIVE", message: `Browser session is ${session.status.toLowerCase()}.`, status: 409 });
		}
		if (context.source === "AGENT" && session.status === "HUMAN_CONTROL") {
			throw new ToolGatewayError({ code: "BROWSER_HUMAN_CONTROL", message: "The user currently owns this browser session.", status: 409 });
		}
		if (context.source === "USER" && session.status !== "HUMAN_CONTROL") {
			throw new ToolGatewayError({ code: "BROWSER_AGENT_CONTROL", message: "Take control of the browser before sending human input.", status: 409 });
		}
		if (session.mode === "OBSERVE" && !["navigate", "scroll", "wait", "inspect"].includes(action)) {
			throw new ToolGatewayError({ code: "BROWSER_MODE_DENIED", message: "Observe mode cannot mutate page state.", status: 403 });
		}
		if (!session.permissions.includes(action)) {
			throw new ToolGatewayError({ code: "BROWSER_PERMISSION_DENIED", message: "Browser action is outside the session permission scope.", status: 403 });
		}
		const actionInput = {
			selector: parsed.data.selector,
			text: parsed.data.text,
			value: parsed.data.value,
			key: parsed.data.key,
			url: parsed.data.url,
			x: parsed.data.x,
			y: parsed.data.y,
			deltaY: parsed.data.deltaY,
			milliseconds: parsed.data.milliseconds,
		};
		const result = await runRemoteBrowserAction(session.id, { action, ...actionInput });
		await Promise.all([
			updateBrowserSession({ sessionId: session.id, currentUrl: result.currentUrl, screenshotUri: `/api/browser/sessions/${encodeURIComponent(session.id)}/screenshot` }),
			recordBrowserAction({
				sessionId: session.id,
				source: context.source === "USER" ? "HUMAN" : context.source,
				action,
				target: parsed.data.url ?? parsed.data.selector ?? null,
				result: { currentUrl: result.currentUrl, title: result.title },
				risk: ["navigate", "scroll", "wait", "inspect", "hover"].includes(action) ? "LOW" : "MEDIUM",
				screenshotUri: `/api/browser/sessions/${encodeURIComponent(session.id)}/screenshot`,
			}),
		]);
		return {
			result: {
				currentUrl: result.currentUrl,
				title: result.title,
				...(result.text ? { text: result.text.slice(0, 20_000) } : {}),
				console: result.console?.slice(-50) ?? [],
				pageErrors: result.pageErrors?.slice(-50) ?? [],
				networkFailures: result.networkFailures?.slice(-50) ?? [],
			},
		};
	},
};

export const terminalToolAdapter: ToolAdapter = {
	id: "terminal",
	isAvailable: terminalRuntimeHealth,
	async execute(context, action, input) {
		if (action === "status") {
			const parsed = WorkspaceSchema.safeParse(input);
			if (!parsed.success) invalidInput("Terminal workspace input is invalid.");
			await ownedWorktree(context.userId, context.runId, parsed.data.workspaceId);
			return { result: await getRemoteWorkspace(parsed.data.workspaceId) as Record<string, unknown> };
		}
		if (action !== "exec" && action !== "exec_readonly") {
			throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Terminal action ${action} is not supported.`, status: 409 });
		}
		const parsed = TerminalExecSchema.safeParse(input);
		if (!parsed.success) invalidInput("Terminal command input is invalid.");
		await ownedWorktree(context.userId, context.runId, parsed.data.workspaceId);
		const result = await runRemoteCommand(parsed.data);
		return { result };
	},
};

export const gitToolAdapter: ToolAdapter = {
	id: "git",
	isAvailable: terminalRuntimeHealth,
	async execute(context, action, input) {
		if (action === "create_worktree") {
			if (!context.taskId) throw new ToolGatewayError({ code: "TASK_REQUIRED", message: "A task is required to create a worktree.", status: 400 });
			const parsed = CreateWorktreeSchema.safeParse(input);
			if (!parsed.success) invalidInput("Worktree input is invalid.");
			const workspaceId = `wt-${context.taskId}`;
			const branch = `aira/${context.runId.slice(0, 8)}/${context.taskId.slice(0, 8)}`;
			const record = await createWorktreeRecord({
				userId: context.userId,
				projectId: context.projectId,
				runId: context.runId,
				taskId: context.taskId,
				workspaceId,
				branch,
				baseRef: parsed.data.baseRef,
				metadata: { repositoryHost: new URL(parsed.data.repositoryUrl).hostname },
			});
			try {
				const workspace = await createRemoteWorkspace({
					workspaceId: record.workspaceId,
					projectKey: context.projectId,
					repositoryUrl: parsed.data.repositoryUrl,
					baseRef: record.baseRef,
					branch: record.branch,
				});
				await updateWorktreeStatus(context.userId, record.workspaceId, "READY");
				return { result: workspace as Record<string, unknown> };
			} catch (error) {
				await updateWorktreeStatus(context.userId, record.workspaceId, "FAILED").catch(() => undefined);
				throw error;
			}
		}

		if (action === "status" || action === "diff" || action === "commit" || action === "cleanup_worktree") {
			const parsed = (action === "commit" ? CommitSchema : WorkspaceSchema).safeParse(input);
			if (!parsed.success) invalidInput("Git workspace input is invalid.");
			const record = await ownedWorktree(context.userId, context.runId, parsed.data.workspaceId);
			if (action === "status") return { result: await getRemoteWorkspace(record.workspaceId) as Record<string, unknown> };
			if (action === "diff") return { result: await getRemoteWorkspaceDiff(record.workspaceId) };
			if (action === "commit") {
				const commitInput = CommitSchema.parse(input);
				const result = await commitRemoteWorkspace(record.workspaceId, commitInput.message);
				await updateWorktreeStatus(context.userId, record.workspaceId, "DIRTY", result);
				return { result };
			}
			await closeRemoteWorkspace(record.workspaceId);
			await updateWorktreeStatus(context.userId, record.workspaceId, "CLEANED");
			return { result: { removed: true, workspaceId: record.workspaceId } };
		}

		if (action === "merge_local") {
			const parsed = MergeSchema.safeParse(input);
			if (!parsed.success) invalidInput("Git merge input is invalid.");
			const target = await ownedWorktree(context.userId, context.runId, parsed.data.targetWorkspaceId);
			const source = await ownedWorktree(context.userId, context.runId, parsed.data.sourceWorkspaceId);
			const result = await mergeRemoteWorkspace(target.workspaceId, source.branch);
			const merged = result.merged === true;
			await updateWorktreeStatus(context.userId, target.workspaceId, merged ? "DIRTY" : "CONFLICT", result);
			if (merged) await updateWorktreeStatus(context.userId, source.workspaceId, "INTEGRATED", { targetWorkspaceId: target.workspaceId });
			return { result };
		}

		throw new ToolGatewayError({
			code: "TOOL_ACTION_UNSUPPORTED",
			message: `Git action ${action} is not exposed by the isolated worker. Remote push/merge must use a separately authorized integration.`,
			status: 409,
		});
	},
};

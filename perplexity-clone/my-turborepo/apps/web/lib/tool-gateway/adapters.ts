import { z } from "zod";

import {
	claimBrowserActionLease,
	releaseBrowserActionLease,
} from "@/lib/agent-platform/browser-arbitration";
import {
	getBrowserSession,
	getProjectForUser,
	recordBrowserAction,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import {
	createWorktreeRecord,
	getScopedWorktree,
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

import type { ToolAdapter, ToolContext } from "./types";
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
}).strict();

const WorkspaceSchema = z.object({ workspaceId: z.string().min(8).max(128) });
const CommitSchema = WorkspaceSchema.extend({ message: z.string().trim().min(1).max(500) });
const MergeSchema = z.object({ targetWorkspaceId: z.string().min(8).max(128), sourceWorkspaceId: z.string().min(8).max(128) });

function invalidInput(message: string): never {
	throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message, status: 400 });
}

function canonicalRepositoryUrl(value: string): string | null {
	const raw = value.trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length < 2 || parts.some((part) => part === "." || part === "..")) return null;
		let pathname = `/${parts.join("/")}`;
		if (!pathname.toLowerCase().endsWith(".git")) pathname += ".git";
		url.pathname = pathname;
		return url.toString();
	} catch {
		return null;
	}
}

function safeBaseRef(value: string): string | null {
	const ref = value.trim();
	if (!ref || ref.length > 192 || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".") || ref.includes("..") || ref.includes("@{") || ref.includes("//")) return null;
	const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
	for (const char of ref) {
		const code = char.charCodeAt(0);
		if (code <= 32 || code === 127 || forbidden.has(char)) return null;
	}
	return ref;
}

function projectRepositoryBinding(config: Record<string, unknown>): { repositoryUrl: string; baseRef: string; repositoryHost: string } | null {
	const configuredUrl = typeof config.repositoryUrl === "string" ? config.repositoryUrl.trim() : "";
	const configuredBaseRef = typeof config.baseRef === "string" ? config.baseRef.trim() : "";
	let repositoryUrl: string | null;
	if (configuredUrl) {
		repositoryUrl = canonicalRepositoryUrl(configuredUrl);
		if (!repositoryUrl) return null;
	} else {
		const serverRepository = process.env.AIRA_GITHUB_REPOSITORY?.trim().replace(/^\/+|\/+$/g, "");
		if (!serverRepository) return null;
		repositoryUrl = canonicalRepositoryUrl(`https://github.com/${serverRepository}`);
		if (!repositoryUrl) return null;
	}
	const baseRef = safeBaseRef(configuredBaseRef || process.env.AIRA_GITHUB_BASE_BRANCH?.trim() || "main");
	if (!baseRef) return null;
	return { repositoryUrl, baseRef, repositoryHost: new URL(repositoryUrl).hostname };
}

async function ownedWorktree(
	context: ToolContext,
	workspaceId: string,
	options: { readonly allowSiblingTask?: boolean } = {},
) {
	const record = await getScopedWorktree(context, workspaceId, options);
	if (!record) {
		throw new ToolGatewayError({ code: "WORKTREE_NOT_FOUND", message: "Worktree not found in this mission and task scope.", status: 404 });
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

		const leaseOwner = `browser:${context.source.toLowerCase()}:${crypto.randomUUID()}`;
		const claimed = await claimBrowserActionLease({
			userId: context.userId,
			sessionId: session.id,
			source: context.source === "USER" ? "USER" : "AGENT",
			leaseOwner,
		});
		if (!claimed) {
			throw new ToolGatewayError({
				code: "BROWSER_CONTROL_RACE",
				message: "Browser ownership changed or another action is already in progress. Refresh session state before retrying.",
				status: 409,
				retryable: true,
			});
		}

		try {
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
		} finally {
			await releaseBrowserActionLease({ userId: context.userId, sessionId: session.id, leaseOwner }).catch(() => undefined);
		}
	},
};

export const terminalToolAdapter: ToolAdapter = {
	id: "terminal",
	isAvailable: terminalRuntimeHealth,
	async execute(context, action, input) {
		if (action === "status") {
			const parsed = WorkspaceSchema.safeParse(input);
			if (!parsed.success) invalidInput("Terminal workspace input is invalid.");
			await ownedWorktree(context, parsed.data.workspaceId);
			return { result: await getRemoteWorkspace(parsed.data.workspaceId) as Record<string, unknown> };
		}
		if (action !== "exec" && action !== "exec_readonly") {
			throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Terminal action ${action} is not supported.`, status: 409 });
		}
		const parsed = TerminalExecSchema.safeParse(input);
		if (!parsed.success) invalidInput("Terminal command input is invalid.");
		await ownedWorktree(context, parsed.data.workspaceId);
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
			const project = await getProjectForUser(context.userId, context.projectId);
			if (!project) throw new ToolGatewayError({ code: "PROJECT_NOT_FOUND", message: "The project is outside this user scope.", status: 404 });
			const binding = projectRepositoryBinding(project.config);
			if (!binding) throw new ToolGatewayError({ code: "WORKTREE_REPOSITORY_UNBOUND", message: "This project has no valid server-authoritative repository binding.", status: 409 });
			const requestedRepository = canonicalRepositoryUrl(parsed.data.repositoryUrl);
			if (!requestedRepository || requestedRepository !== binding.repositoryUrl || parsed.data.baseRef !== binding.baseRef) {
				throw new ToolGatewayError({ code: "WORKTREE_REPOSITORY_OVERRIDE_DENIED", message: "Worktree repository and base ref are controlled by the project binding.", status: 403 });
			}
			const workspaceId = `wt-${context.taskId}`;
			const branch = `aira/${context.runId.slice(0, 8)}/${context.taskId.slice(0, 8)}`;
			const record = await createWorktreeRecord({
				userId: context.userId,
				projectId: context.projectId,
				runId: context.runId,
				taskId: context.taskId,
				workspaceId,
				branch,
				baseRef: binding.baseRef,
				metadata: { repositoryHost: binding.repositoryHost, repositoryUrl: binding.repositoryUrl },
			});
			if (record.baseRef !== binding.baseRef || record.metadata.repositoryUrl !== binding.repositoryUrl) {
				throw new ToolGatewayError({ code: "WORKTREE_REPOSITORY_BINDING_MISMATCH", message: "The existing worktree record is not bound to this project's exact repository identity.", status: 409 });
			}
			try {
				const workspace = await createRemoteWorkspace({
					workspaceId: record.workspaceId,
					projectKey: context.projectId,
					repositoryUrl: binding.repositoryUrl,
					baseRef: binding.baseRef,
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
			const record = await ownedWorktree(context, parsed.data.workspaceId);
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
			const target = await ownedWorktree(context, parsed.data.targetWorkspaceId);
			const source = await ownedWorktree(context, parsed.data.sourceWorkspaceId, { allowSiblingTask: true });
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
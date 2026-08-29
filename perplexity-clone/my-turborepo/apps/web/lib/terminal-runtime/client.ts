import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 15_000;

const ExecResultSchema = z.object({
	exitCode: z.number().int(),
	stdout: z.string(),
	stderr: z.string(),
	truncated: z.boolean(),
	durationMs: z.number().int().nonnegative(),
});

const WorkspaceSchema = z.object({
	workspaceId: z.string(),
	branch: z.string().optional(),
	baseRef: z.string().optional(),
	repositoryUrl: z.string().optional(),
	dirty: z.boolean().optional(),
	status: z.unknown().optional(),
});

export type TerminalExecResult = z.infer<typeof ExecResultSchema>;
export type TerminalWorkspace = z.infer<typeof WorkspaceSchema>;

export class TerminalRuntimeError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;

	constructor(options: { code: string; message: string; status?: number; retryable?: boolean }) {
		super(options.message);
		this.name = "TerminalRuntimeError";
		this.code = options.code;
		this.status = options.status ?? 500;
		this.retryable = options.retryable ?? false;
	}
}

export function isTerminalRuntimeEnabled(): boolean {
	return ["1", "true", "yes", "on"].includes(
		(process.env.AIRA_TERMINAL_RUNTIME_ENABLED ?? "").trim().toLowerCase(),
	);
}

function normalizeBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_CONFIG_INVALID", message: "AIRA_TERMINAL_RUNTIME_URL must be a valid URL.", status: 503 });
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_CONFIG_INVALID", message: "Terminal runtime URL cannot contain credentials, query parameters, or fragments.", status: 503 });
	}
	const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) {
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_INSECURE_URL", message: "Terminal runtime requires HTTPS outside loopback in production.", status: 503 });
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_CONFIG_INVALID", message: "Terminal runtime must use HTTP or HTTPS.", status: 503 });
	}
	return url.toString().replace(/\/$/, "");
}

function config(): { baseUrl: string; token: string; timeoutMs: number } {
	const rawUrl = process.env.AIRA_TERMINAL_RUNTIME_URL?.trim();
	const token = process.env.AIRA_TERMINAL_RUNTIME_TOKEN?.trim();
	if (!rawUrl || !token) {
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_NOT_CONFIGURED", message: "Terminal runtime is not configured.", status: 503 });
	}
	const parsed = Number(process.env.AIRA_TERMINAL_RUNTIME_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
	return {
		baseUrl: normalizeBaseUrl(rawUrl),
		token,
		timeoutMs: Number.isFinite(parsed) ? Math.max(1_000, Math.min(120_000, Math.trunc(parsed))) : DEFAULT_TIMEOUT_MS,
	};
}

export function isTerminalRuntimeConfigured(): boolean {
	try {
		config();
		return true;
	} catch {
		return false;
	}
}

async function runtimeFetch(path: string, init: RequestInit = {}, timeoutOverride?: number): Promise<Response> {
	const runtime = config();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutOverride ?? runtime.timeoutMs);
	try {
		const response = await fetch(`${runtime.baseUrl}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${runtime.token}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...(init.headers ?? {}),
			},
			signal: controller.signal,
			cache: "no-store",
		});
		if (!response.ok) {
			throw new TerminalRuntimeError({
				code: "TERMINAL_RUNTIME_REQUEST_FAILED",
				message: `Terminal runtime returned HTTP ${response.status}.`,
				status: response.status >= 400 && response.status < 600 ? response.status : 502,
				retryable: response.status === 408 || response.status === 429 || response.status >= 500,
			});
		}
		return response;
	} catch (error) {
		if (error instanceof TerminalRuntimeError) throw error;
		throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_UNREACHABLE", message: "Terminal runtime is temporarily unreachable.", status: 503, retryable: true });
	} finally {
		clearTimeout(timer);
	}
}

export async function terminalRuntimeHealth(): Promise<boolean> {
	if (!isTerminalRuntimeEnabled() || !isTerminalRuntimeConfigured()) return false;
	try {
		const response = await runtimeFetch("/healthz", {}, 3_000);
		return response.ok;
	} catch {
		return false;
	}
}

export async function createRemoteWorkspace(input: {
	readonly workspaceId: string;
	readonly projectKey: string;
	readonly repositoryUrl: string;
	readonly baseRef: string;
	readonly branch: string;
}): Promise<TerminalWorkspace> {
	const response = await runtimeFetch("/v1/workspaces", { method: "POST", body: JSON.stringify(input) }, 360_000);
	const parsed = WorkspaceSchema.safeParse(await response.json());
	if (!parsed.success) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid workspace response.", status: 502 });
	return parsed.data;
}

export async function getRemoteWorkspace(workspaceId: string): Promise<TerminalWorkspace> {
	const response = await runtimeFetch(`/v1/workspaces/${encodeURIComponent(workspaceId)}`);
	const parsed = WorkspaceSchema.safeParse(await response.json());
	if (!parsed.success) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid workspace state.", status: 502 });
	return parsed.data;
}

export async function runRemoteCommand(input: {
	readonly workspaceId: string;
	readonly argv: readonly string[];
	readonly cwd?: string;
	readonly timeoutSeconds?: number;
}): Promise<TerminalExecResult> {
	const response = await runtimeFetch(
		`/v1/workspaces/${encodeURIComponent(input.workspaceId)}/exec`,
		{
			method: "POST",
			body: JSON.stringify({ argv: input.argv, cwd: input.cwd, timeoutSeconds: input.timeoutSeconds }),
		},
		Math.max(15_000, Math.min(930_000, (input.timeoutSeconds ?? 180) * 1000 + 15_000)),
	);
	const parsed = ExecResultSchema.safeParse(await response.json());
	if (!parsed.success) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid command result.", status: 502 });
	return parsed.data;
}

export async function getRemoteWorkspaceDiff(workspaceId: string): Promise<Record<string, unknown>> {
	const response = await runtimeFetch(`/v1/workspaces/${encodeURIComponent(workspaceId)}/diff`);
	const value = await response.json();
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid diff response.", status: 502 });
	return value as Record<string, unknown>;
}

export async function commitRemoteWorkspace(workspaceId: string, message: string): Promise<Record<string, unknown>> {
	const response = await runtimeFetch(`/v1/workspaces/${encodeURIComponent(workspaceId)}/commit`, { method: "POST", body: JSON.stringify({ message }) }, 150_000);
	const value = await response.json();
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid commit response.", status: 502 });
	return value as Record<string, unknown>;
}

export async function mergeRemoteWorkspace(workspaceId: string, sourceBranch: string): Promise<Record<string, unknown>> {
	const response = await runtimeFetch(`/v1/workspaces/${encodeURIComponent(workspaceId)}/merge`, { method: "POST", body: JSON.stringify({ sourceBranch }) }, 210_000);
	const value = await response.json();
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TerminalRuntimeError({ code: "TERMINAL_RUNTIME_RESPONSE_INVALID", message: "Terminal runtime returned an invalid merge response.", status: 502 });
	return value as Record<string, unknown>;
}

export async function closeRemoteWorkspace(workspaceId: string): Promise<void> {
	await runtimeFetch(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" }, 150_000);
}

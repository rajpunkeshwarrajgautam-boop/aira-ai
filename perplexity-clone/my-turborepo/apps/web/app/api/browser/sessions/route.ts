import { z } from "zod";

import { auth } from "@/auth";
import {
	createBrowserSession,
	getProjectForUser,
	getRunForUser,
	listBrowserSessions,
	listTasks,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import {
	browserRuntimeHealth,
	BrowserRuntimeError,
	createRemoteBrowserSession,
	isBrowserRuntimeConfigured,
	isBrowserRuntimeEnabled,
} from "@/lib/browser-runtime/client";

import {
	checkBrowserRateLimit,
	MAX_ACTIVE_SESSIONS_PER_USER,
} from "@/lib/browser-runtime/rate-limiter";
import { publicWebUrl } from "@/lib/tool-gateway/web-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DomainSchema = z
	.string()
	.trim()
	.min(1)
	.max(253)
	.regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/);

const CreateSchema = z.object({
	mode: z.enum(["OBSERVE", "ASSISTED", "AUTONOMOUS"]).default("ASSISTED"),
	allowedDomains: z.array(DomainSchema).min(1).max(25),
	startUrl: z.string().url().max(4096).optional(),
	width: z.number().int().min(320).max(2560).default(1440),
	height: z.number().int().min(480).max(1600).default(900),
	ttlMinutes: z.number().int().min(1).max(240).default(60),
	projectId: z.string().min(1).max(128).optional(),
	runId: z.string().min(1).max(128).optional(),
	taskId: z.string().min(1).max(128).optional(),
});

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	const [sessions, healthy] = await Promise.all([
		listBrowserSessions(session.user.id),
		browserRuntimeHealth(),
	]);
	return json({
		sessions,
		runtime: {
			enabled: isBrowserRuntimeEnabled(),
			configured: isBrowserRuntimeConfigured(),
			healthy,
			ready: isBrowserRuntimeEnabled() && isBrowserRuntimeConfigured() && healthy,
		},
	});
}

export async function POST(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	}
	if (!isBrowserRuntimeEnabled() || !isBrowserRuntimeConfigured()) {
		return json({ error: { code: "BROWSER_RUNTIME_NOT_READY", message: "Browser runtime is not enabled and configured." } }, { status: 503 });
	}

	const existingSessions = await listBrowserSessions(session.user.id);
	const activeCount = existingSessions.filter(
		(s) => (s.status === "ACTIVE" || s.status === "HUMAN_CONTROL") && s.expiresAt.getTime() > Date.now(),
	).length;
	if (activeCount >= MAX_ACTIVE_SESSIONS_PER_USER) {
		return json(
			{ error: { code: "BROWSER_RATE_LIMITED", message: `Maximum active browser sessions (${MAX_ACTIVE_SESSIONS_PER_USER}) reached. Close an active session first.` } },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}

	const rate = await checkBrowserRateLimit(session.user.id, "session_create");
	if (!rate.allowed) {
		if (rate.error === "BROWSER_RATE_LIMIT_UNAVAILABLE") {
			return json(
				{ error: { code: "BROWSER_RATE_LIMIT_UNAVAILABLE", message: "Browser rate limiting service is currently unavailable. Please retry shortly." } },
				{ status: 503, headers: { "Retry-After": "5" } },
			);
		}
		return json(
			{ error: { code: "BROWSER_RATE_LIMITED", message: "Too many browser sessions created. Please slow down." } },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
		);
	}

	const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: { code: "VALIDATION_ERROR", message: "Browser session configuration is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	}
	const input = parsed.data;
	if (input.startUrl && !publicWebUrl(input.startUrl)) {
		return json({ error: { code: "BROWSER_URL_BLOCKED", message: "startUrl is not a permitted public HTTP(S) URL." } }, { status: 400 });
	}
	if (input.projectId && !(await getProjectForUser(session.user.id, input.projectId))) {
		return json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
	}
	if (input.runId) {
		const run = await getRunForUser(session.user.id, input.runId);
		if (!run || (input.projectId && run.projectId !== input.projectId)) {
			return json({ error: { code: "NOT_FOUND", message: "Managed run not found." } }, { status: 404 });
		}
		if (input.taskId && !(await listTasks(run.id)).some((task) => task.id === input.taskId)) {
			return json({ error: { code: "NOT_FOUND", message: "Managed task not found." } }, { status: 404 });
		}
	} else if (input.taskId) {
		return json({ error: { code: "VALIDATION_ERROR", message: "taskId requires runId." } }, { status: 400 });
	}

	const domains = Array.from(new Set(input.allowedDomains.map((domain) => domain.toLowerCase())));
	const record = await createBrowserSession({
		userId: session.user.id,
		projectId: input.projectId,
		runId: input.runId,
		taskId: input.taskId,
		mode: input.mode,
		allowedDomains: domains,
		permissions: input.mode === "OBSERVE"
			? ["navigate", "inspect", "scroll", "screenshot", "wait", "back", "forward"]
			: ["navigate", "inspect", "scroll", "screenshot", "wait", "back", "forward", "click", "double_click", "click_at", "fill", "press", "select", "hover"],
		ttlMinutes: input.ttlMinutes,
	});
	try {
		const remote = await createRemoteBrowserSession({
			sessionId: record.id,
			allowedDomains: domains,
			width: input.width,
			height: input.height,
			ttlSeconds: input.ttlMinutes * 60,
			...(input.startUrl ? { startUrl: input.startUrl } : {}),
		});
		await updateBrowserSession({
			sessionId: record.id,
			status: "ACTIVE",
			remoteSessionId: remote.sessionId,
			currentUrl: remote.currentUrl ?? null,
			screenshotUri: `/api/browser/sessions/${encodeURIComponent(record.id)}/screenshot`,
		});
		return json({
			session: {
				...record,
				status: "ACTIVE",
				remoteSessionId: remote.sessionId,
				currentUrl: remote.currentUrl ?? null,
				lastScreenshotUri: `/api/browser/sessions/${encodeURIComponent(record.id)}/screenshot`,
			},
		}, { status: 201 });
	} catch (error) {
		await updateBrowserSession({ sessionId: record.id, status: "FAILED" }).catch(() => undefined);
		if (error instanceof BrowserRuntimeError) {
			return json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.status });
		}
		console.error("[browser:sessions:create]", error);
		return json({ error: { code: "BROWSER_SESSION_FAILED", message: "AIRA could not create the browser session." } }, { status: 500 });
	}
}

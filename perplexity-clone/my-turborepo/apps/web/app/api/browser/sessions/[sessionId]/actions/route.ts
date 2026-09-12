import { z } from "zod";

import { auth } from "@/auth";
import {
	claimBrowserActionLease,
	releaseBrowserActionLease,
} from "@/lib/agent-platform/browser-arbitration";
import {
	getBrowserSession,
	recordBrowserAction,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import type { RiskClass } from "@/lib/agent-platform/types";
import { BrowserRuntimeError, runRemoteBrowserAction } from "@/lib/browser-runtime/client";
import { checkBrowserRateLimit } from "@/lib/browser-runtime/rate-limiter";
import { publicWebUrl } from "@/lib/tool-gateway/web-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string }> };

const ActionSchema = z.object({
	action: z.enum([
		"navigate",
		"click",
		"double_click",
		"click_at",
		"fill",
		"press",
		"select",
		"scroll",
		"hover",
		"wait",
		"inspect",
		"back",
		"forward",
	]),
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

const OBSERVE_ACTIONS = new Set(["navigate", "scroll", "wait", "inspect", "back", "forward"]);
const LOW_RISK_ACTIONS = new Set(["navigate", "scroll", "wait", "inspect", "hover", "back", "forward"]);

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }, { status: 401 });
	const { sessionId } = await params;
	const record = await getBrowserSession(session.user.id, sessionId);
	if (!record) return json({ error: { code: "NOT_FOUND", message: "Browser session not found." } }, { status: 404 });
	if (record.expiresAt.getTime() <= Date.now()) {
		await updateBrowserSession({ sessionId: record.id, status: "EXPIRED" });
		return json({ error: { code: "BROWSER_SESSION_EXPIRED", message: "Browser session expired." } }, { status: 410 });
	}
	if (["ENDED", "FAILED", "EXPIRED", "PAUSED"].includes(record.status)) {
		return json({ error: { code: "BROWSER_SESSION_NOT_ACTIVE", message: `Browser session is ${record.status.toLowerCase()}.` } }, { status: 409 });
	}
	if (record.status !== "HUMAN_CONTROL") {
		return json({ error: { code: "BROWSER_AGENT_CONTROL", message: "Take control of the browser before sending human input." } }, { status: 409 });
	}

	const rate = checkBrowserRateLimit(session.user.id, "action");
	if (!rate.allowed) {
		return json(
			{ error: { code: "BROWSER_RATE_LIMITED", message: "Browser action rate limit exceeded." } },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
		);
	}

	const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Browser action is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	if (parsed.data.action === "navigate") {
		if (!parsed.data.url || !publicWebUrl(parsed.data.url)) {
			return json({ error: { code: "BROWSER_URL_BLOCKED", message: "Invalid or non-public navigation URL target." } }, { status: 400 });
		}
	}
	if (record.mode === "OBSERVE" && !OBSERVE_ACTIONS.has(parsed.data.action)) {
		return json({ error: { code: "BROWSER_MODE_DENIED", message: "Observe mode cannot mutate page state." } }, { status: 403 });
	}
	if (!record.permissions.includes(parsed.data.action)) {
		return json({ error: { code: "BROWSER_PERMISSION_DENIED", message: "This action is outside the session permission scope." } }, { status: 403 });
	}

	const leaseOwner = `browser:user:${crypto.randomUUID()}`;
	const claimed = await claimBrowserActionLease({
		userId: session.user.id,
		sessionId: record.id,
		source: "USER",
		leaseOwner,
	});
	if (!claimed) {
		return json({ error: { code: "BROWSER_CONTROL_RACE", message: "Browser action lease could not be acquired or another action is in progress." } }, { status: 409 });
	}

	const risk: RiskClass = LOW_RISK_ACTIONS.has(parsed.data.action) ? "LOW" : "HIGH";
	const source = "HUMAN";
	try {
		const result = await runRemoteBrowserAction(record.id, parsed.data);
		await Promise.all([
			updateBrowserSession({ sessionId: record.id, currentUrl: result.currentUrl, screenshotUri: `/api/browser/sessions/${encodeURIComponent(record.id)}/screenshot` }),
			recordBrowserAction({
				sessionId: record.id,
				source,
				action: parsed.data.action,
				target: parsed.data.url ?? parsed.data.selector ?? (parsed.data.x !== undefined ? `${parsed.data.x},${parsed.data.y}` : null),
				result: { currentUrl: result.currentUrl, title: result.title },
				risk,
				screenshotUri: `/api/browser/sessions/${encodeURIComponent(record.id)}/screenshot`,
			}),
		]);
		return json({ result });
	} catch (error) {
		await recordBrowserAction({
			sessionId: record.id,
			source,
			action: parsed.data.action,
			target: parsed.data.url ?? parsed.data.selector ?? null,
			result: { failed: true },
			risk,
		}).catch(() => undefined);
		if (error instanceof BrowserRuntimeError) return json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.status });
		return json({ error: { code: "BROWSER_ACTION_FAILED", message: "Browser action failed." } }, { status: 500 });
	} finally {
		await releaseBrowserActionLease({ userId: session.user.id, sessionId: record.id, leaseOwner }).catch(() => undefined);
	}
}

import { z } from "zod";

import { auth } from "@/auth";
import {
	getBrowserSession,
	recordBrowserAction,
	updateBrowserSession,
} from "@/lib/agent-platform/store";
import type { RiskClass } from "@/lib/agent-platform/types";
import { BrowserRuntimeError, runRemoteBrowserAction } from "@/lib/browser-runtime/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sessionId: string }> };

const ActionSchema = z.object({
	action: z.enum(["navigate", "click", "double_click", "click_at", "fill", "press", "select", "scroll", "hover", "wait", "inspect"]),
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

const OBSERVE_ACTIONS = new Set(["navigate", "scroll", "wait", "inspect"]);
const LOW_RISK_ACTIONS = new Set(["navigate", "scroll", "wait", "inspect", "hover"]);

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
	const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json({ error: { code: "VALIDATION_ERROR", message: "Browser action is invalid.", details: z.treeifyError(parsed.error) } }, { status: 400 });
	if (record.mode === "OBSERVE" && !OBSERVE_ACTIONS.has(parsed.data.action)) {
		return json({ error: { code: "BROWSER_MODE_DENIED", message: "Observe mode cannot mutate page state." } }, { status: 403 });
	}
	if (!record.permissions.includes(parsed.data.action)) {
		return json({ error: { code: "BROWSER_PERMISSION_DENIED", message: "This action is outside the session permission scope." } }, { status: 403 });
	}
	const risk: RiskClass = LOW_RISK_ACTIONS.has(parsed.data.action) ? "LOW" : "MEDIUM";
	const source = record.status === "HUMAN_CONTROL" ? "HUMAN" : "AGENT";
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
	}
}

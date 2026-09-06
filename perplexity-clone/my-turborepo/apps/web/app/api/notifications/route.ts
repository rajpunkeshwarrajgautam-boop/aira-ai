import { auth } from "@/auth";
import { globalAutomationEngine } from "@/lib/automation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, {
		...init,
		headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
	});
}

export async function GET(): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	const notifications = globalAutomationEngine.getUserNotifications(session.user.id);
	const unreadCount = notifications.filter((n) => !n.read).length;

	return json({
		notifications,
		unreadCount,
	});
}

export async function PATCH(req: Request): Promise<Response> {
	const session = await auth();
	if (!session?.user?.id) {
		return json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
	}

	try {
		const body = await req.json();
		const { id } = body;
		if (typeof id !== "string") {
			return json({ error: { code: "BAD_REQUEST", message: "Notification ID is required." } }, { status: 400 });
		}
		const marked = globalAutomationEngine.markNotificationRead(session.user.id, id);
		return json({ success: marked });
	} catch {
		return json({ error: { code: "SERVER_ERROR", message: "Failed to update notification." } }, { status: 500 });
	}
}

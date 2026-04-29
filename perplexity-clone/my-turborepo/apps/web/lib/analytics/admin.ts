import { auth } from "@/auth";

const ADMIN_EMAILS_ENV = "ANALYTICS_ADMIN_EMAIL";
const ADMIN_EMAILS_MULTI_ENV = "ANALYTICS_ADMIN_EMAILS";

function parseAdminEmails(): readonly string[] {
	const single = process.env[ADMIN_EMAILS_ENV]?.trim();
	const multi = process.env[ADMIN_EMAILS_MULTI_ENV]?.trim();
	const raw = [single, multi].filter(Boolean).join(",");
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export async function requireAnalyticsAdmin(): Promise<{ readonly userId: string }> {
	const session = await auth();
	const email = session?.user?.email?.toLowerCase();

	if (process.env.NODE_ENV !== "production") {
		if (session?.user?.id) return { userId: session.user.id };
	}

	const admins = parseAdminEmails();
	if (email && admins.includes(email) && session?.user?.id) {
		return { userId: session.user.id };
	}

	// Deliberately vague to avoid leaking admin policy.
	throw new Error("ANALYTICS_ADMIN_REQUIRED");
}


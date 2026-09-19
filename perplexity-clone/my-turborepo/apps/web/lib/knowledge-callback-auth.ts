import { timingSafeEqual } from "node:crypto";

export function validWorkerToken(req: Request): boolean {
	const expected = process.env.AIRA_KNOWLEDGE_WORKER_TOKEN?.trim();
	const supplied = req.headers.get("x-aira-worker-token")?.trim();
	if (!expected || !supplied) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(supplied);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeCallbackOrigin(raw: string | undefined): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed || trimmed.includes(" ") || trimmed.includes("\\")) return null;

	// Reject any custom or unsupported scheme (e.g. ftp://, javascript:, file://)
	if (trimmed.includes(":") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
		const colonIdx = trimmed.indexOf(":");
		const slashIdx = trimmed.indexOf("/");
		if (slashIdx === -1 || colonIdx < slashIdx) {
			const beforeColon = trimmed.slice(0, colonIdx);
			if (beforeColon.includes(".")) {
				if (trimmed.slice(colonIdx).startsWith("://")) return null;
			} else if (beforeColon !== "localhost" && beforeColon !== "127.0.0.1") {
				if (trimmed.slice(colonIdx).startsWith("://")) return null;
				const portPart = trimmed.slice(colonIdx + 1).split("/")[0] ?? "";
				if (!/^\d+$/.test(portPart)) return null;
			}
		}
	}

	try {
		const withProto =
			trimmed.startsWith("http://") || trimmed.startsWith("https://")
				? trimmed
				: `https://${trimmed}`;
		const parsed = new URL(withProto);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
		if (parsed.username || parsed.password) return null;
		if (!parsed.origin || parsed.origin === "null" || parsed.origin.includes("*")) return null;
		if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
		return parsed.origin;
	} catch {
		return null;
	}
}

export function knowledgeCallbackUrl(): string | null {
	const candidates = [
		process.env.AUTH_URL,
		process.env.NEXTAUTH_URL,
		process.env.VERCEL_BRANCH_URL,
		process.env.VERCEL_URL,
	];

	for (const candidate of candidates) {
		const origin = normalizeCallbackOrigin(candidate);
		if (origin) {
			try {
				const callbackUrl = new URL("/api/knowledge/callback", origin);
				callbackUrl.search = "";
				callbackUrl.hash = "";
				return callbackUrl.toString();
			} catch {
				return null;
			}
		}
	}
	return null;
}

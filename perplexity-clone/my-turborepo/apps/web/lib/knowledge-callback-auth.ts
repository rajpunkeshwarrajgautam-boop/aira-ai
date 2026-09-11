import { timingSafeEqual } from "node:crypto";

export function validWorkerToken(req: Request): boolean {
	const expected = process.env.AIRA_KNOWLEDGE_WORKER_TOKEN?.trim();
	const supplied = req.headers.get("x-aira-worker-token")?.trim();
	if (!expected || !supplied) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(supplied);
	return a.length === b.length && timingSafeEqual(a, b);
}

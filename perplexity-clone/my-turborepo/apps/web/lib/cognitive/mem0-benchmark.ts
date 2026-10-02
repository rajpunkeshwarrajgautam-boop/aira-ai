import { createHmac } from "node:crypto";

import { containsProhibitedMemoryData } from "./agentmemory";

const MEM0_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARS = 64_000;
const MAX_RECALL_ITEMS = 6;
const MAX_RECALL_ITEM_CHARS = 1_800;
const MAX_RECALL_CHARS = 8_000;
const MAX_WRITE_CHARS = 12_000;

interface Mem0BenchmarkConfig {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly entitySalt: string;
}

interface Mem0SearchRow {
	readonly memory?: unknown;
	readonly user_id?: unknown;
	readonly metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function configuredMem0Benchmark(): Mem0BenchmarkConfig | null {
	if (process.env.AIRA_MEM0_BENCHMARK_ENABLED !== "true") return null;
	const apiKey = process.env.AIRA_MEM0_BENCHMARK_API_KEY?.trim();
	const entitySalt = process.env.AIRA_MEM0_BENCHMARK_ENTITY_SALT?.trim();
	const rawUrl = process.env.AIRA_MEM0_BENCHMARK_URL?.trim() || "https://api.mem0.ai";
	if (!apiKey || apiKey.length < 16 || !entitySalt || entitySalt.length < 16) return null;

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
		return null;
	}
	return {
		baseUrl: parsed.toString().replace(/\/+$/, ""),
		apiKey,
		entitySalt,
	};
}

export function mem0BenchmarkPrincipalId(userId: string, salt: string): string {
	const digest = createHmac("sha256", salt).update(`aira-user:${userId}`).digest("hex");
	return `aira_${digest.slice(0, 48)}`;
}

export function mem0BenchmarkProjectScope(
	userId: string,
	projectId: string | undefined,
	salt: string,
): string {
	const digest = createHmac("sha256", salt)
		.update(`aira-project:${userId}:${projectId?.trim() || "global"}`)
		.digest("hex");
	return `aira_${digest.slice(0, 40)}`;
}

export function buildMem0BenchmarkSearchPayload(args: {
	readonly userId: string;
	readonly query: string;
	readonly entitySalt: string;
}): Record<string, unknown> {
	return {
		query: args.query.slice(0, 4_000),
		filters: {
			user_id: mem0BenchmarkPrincipalId(args.userId, args.entitySalt),
		},
	};
}

export function buildMem0BenchmarkWritePayload(args: {
	readonly userId: string;
	readonly userMessage: string;
	readonly projectId?: string;
	readonly entitySalt: string;
}): Record<string, unknown> {
	const principal = mem0BenchmarkPrincipalId(args.userId, args.entitySalt);
	const projectScope = mem0BenchmarkProjectScope(args.userId, args.projectId, args.entitySalt);
	return {
		messages: [{ role: "user", content: args.userMessage.trim().slice(0, MAX_WRITE_CHARS) }],
		user_id: principal,
		metadata: {
			aira_project_scope: projectScope,
			aira_benchmark: true,
		},
	};
}

function endpointUrl(config: Mem0BenchmarkConfig, path: string): string {
	const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
	return new URL(path.replace(/^\/+/, ""), base).toString();
}

async function mem0Request(
	config: Mem0BenchmarkConfig,
	path: string,
	init: RequestInit,
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MEM0_TIMEOUT_MS);
	try {
		const response = await globalThis.fetch(endpointUrl(config, path), {
			...init,
			headers: {
				Authorization: `Token ${config.apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
				...(init.headers ?? {}),
			},
			signal: controller.signal,
			cache: "no-store",
		});
		if (!response.ok) throw new Error(`Mem0 request failed with status ${response.status}.`);
		const text = await response.text();
		if (text.length > MAX_RESPONSE_CHARS) throw new Error("Mem0 response exceeded the safety limit.");
		return text ? (JSON.parse(text) as unknown) : null;
	} finally {
		clearTimeout(timer);
	}
}

function stripControlCharacters(value: string): string {
	let cleaned = "";
	for (const character of value) {
		const code = character.charCodeAt(0);
		const blocked =
			(code >= 0 && code <= 8) ||
			code === 11 ||
			code === 12 ||
			(code >= 14 && code <= 31) ||
			code === 127;
		cleaned += blocked ? " " : character;
	}
	return cleaned;
}

function cleanRecallText(value: string): string {
	return stripControlCharacters(value)
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, MAX_RECALL_ITEM_CHARS);
}

export function parseMem0BenchmarkRecall(args: {
	readonly result: unknown;
	readonly expectedUserId: string;
	readonly expectedProjectScope: string;
}): string[] {
	const root = asRecord(args.result);
	const rows = Array.isArray(root?.results) ? root.results : [];
	const recalled: string[] = [];
	let totalChars = 0;

	for (const rawRow of rows.slice(0, MAX_RECALL_ITEMS * 4)) {
		const row = asRecord(rawRow) as Mem0SearchRow | null;
		if (!row || row.user_id !== args.expectedUserId || typeof row.memory !== "string") continue;
		const metadata = asRecord(row.metadata);
		if (metadata?.aira_project_scope !== args.expectedProjectScope) continue;
		const cleaned = cleanRecallText(row.memory);
		if (!cleaned) continue;
		if (totalChars + cleaned.length > MAX_RECALL_CHARS) break;
		recalled.push(cleaned);
		totalChars += cleaned.length;
		if (recalled.length >= MAX_RECALL_ITEMS) break;
	}
	return recalled;
}

export function isMem0BenchmarkConfigured(): boolean {
	return configuredMem0Benchmark() !== null;
}

export async function recallMem0BenchmarkContext(args: {
	readonly userId: string;
	readonly query: string;
	readonly projectId?: string;
}): Promise<string[]> {
	const config = configuredMem0Benchmark();
	if (!config) return [];
	const expectedUserId = mem0BenchmarkPrincipalId(args.userId, config.entitySalt);
	const expectedProjectScope = mem0BenchmarkProjectScope(
		args.userId,
		args.projectId,
		config.entitySalt,
	);
	try {
		const result = await mem0Request(config, "/v3/memories/search/", {
			method: "POST",
			body: JSON.stringify(
				buildMem0BenchmarkSearchPayload({
					userId: args.userId,
					query: args.query,
					entitySalt: config.entitySalt,
				}),
			),
		});
		return parseMem0BenchmarkRecall({ result, expectedUserId, expectedProjectScope });
	} catch (error) {
		console.warn("[AiraMem0Benchmark] recall failed", {
			code: error instanceof Error ? error.name : "MEM0_RECALL_FAILED",
		});
		return [];
	}
}

export async function persistMem0BenchmarkTurn(args: {
	readonly userId: string;
	readonly userMessage: string;
	readonly projectId?: string;
}): Promise<boolean> {
	const config = configuredMem0Benchmark();
	if (!config) return false;
	const content = args.userMessage.trim();
	if (!content || containsProhibitedMemoryData(content)) return false;
	try {
		const result = await mem0Request(config, "/v3/memories/add/", {
			method: "POST",
			body: JSON.stringify(
				buildMem0BenchmarkWritePayload({
					userId: args.userId,
					userMessage: content,
					...(args.projectId ? { projectId: args.projectId } : {}),
					entitySalt: config.entitySalt,
				}),
			),
		});
		const root = asRecord(result);
		return Boolean(
			root &&
				(Array.isArray(root.results) || root.status === "PENDING" || typeof root.event_id === "string"),
		);
	} catch (error) {
		console.warn("[AiraMem0Benchmark] write failed", {
			code: error instanceof Error ? error.name : "MEM0_WRITE_FAILED",
		});
		return false;
	}
}

import { createHmac } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const DEFAULT_MEMORI_ENDPOINT = "https://api.memorilabs.ai/mcp/";
const MEMORI_TIMEOUT_MS = 8_000;
const MAX_RECALL_CHARS = 8_000;
const MAX_WRITE_CHARS = 12_000;

interface MemoriConfig {
	readonly endpoint: string;
	readonly apiKey: string;
	readonly entitySalt: string;
	readonly processId: string;
}

function configuredMemori(): MemoriConfig | null {
	if (process.env.AIRA_MEMORI_ENABLED !== "true") return null;
	const apiKey = process.env.AIRA_MEMORI_API_KEY?.trim();
	const entitySalt = process.env.AIRA_MEMORI_ENTITY_SALT?.trim();
	if (!apiKey || !entitySalt) return null;
	const endpoint = process.env.AIRA_MEMORI_ENDPOINT?.trim() || DEFAULT_MEMORI_ENDPOINT;
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && !(process.env.NODE_ENV === "development" && parsed.hostname === "localhost")) {
		return null;
	}
	return {
		endpoint: parsed.toString(),
		apiKey,
		entitySalt,
		processId: (process.env.AIRA_MEMORI_PROCESS_ID?.trim() || "aira-chat").slice(0, 120),
	};
}

function entityId(userId: string, salt: string): string {
	const digest = createHmac("sha256", salt).update(userId).digest("hex");
	return `aira_${digest.slice(0, 40)}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = MEMORI_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise.finally(() => {
			if (timer) clearTimeout(timer);
		}),
		new Promise<T>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Memori MCP operation timed out.")), timeoutMs);
		}),
	]);
}

function headersFor(config: MemoriConfig, userId: string): Record<string, string> {
	return {
		"X-Memori-API-Key": config.apiKey,
		"X-Memori-Entity-Id": entityId(userId, config.entitySalt),
		"X-Memori-Process-Id": config.processId,
	};
}

function createAuthenticatedFetch(headers: Record<string, string>) {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const merged = new Headers(init?.headers);
		for (const [key, value] of Object.entries(headers)) merged.set(key, value);
		return globalThis.fetch(input, { ...init, headers: merged });
	};
}

async function callMemoriTool(
	userId: string,
	name: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const config = configuredMemori();
	if (!config) return null;
	const client = new Client(
		{ name: "aira-ai", version: "1.0.0" },
		{ listMaxPages: 2, versionNegotiation: { mode: "auto" } },
	);
	const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
		fetch: createAuthenticatedFetch(headersFor(config, userId)),
	});
	try {
		await withTimeout(client.connect(transport));
		const result = await withTimeout(client.callTool({ name, arguments: args }));
		if (result.isError) throw new Error(`Memori tool ${name} returned an error.`);
		return result;
	} finally {
		try {
			await withTimeout(client.close(), 2_000);
		} catch {
			// Best-effort teardown must not turn a successful memory operation into a failure.
		}
	}
}

function flattenText(value: unknown, depth = 0): string[] {
	if (depth > 5 || value == null) return [];
	if (typeof value === "string") return [value];
	if (typeof value === "number" || typeof value === "boolean") return [String(value)];
	if (Array.isArray(value)) return value.flatMap((item) => flattenText(item, depth + 1));
	if (typeof value !== "object") return [];
	const object = value as Record<string, unknown>;
	if (object.type === "text" && typeof object.text === "string") return [object.text];
	return Object.entries(object)
		.filter(([key]) => !["id", "requestId", "traceId"].includes(key))
		.flatMap(([, child]) => flattenText(child, depth + 1));
}

function cleanRecallText(value: unknown): string {
	return flattenText(value)
		.join("\n")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, MAX_RECALL_CHARS);
}

export function isMemoriConfigured(): boolean {
	return configuredMemori() !== null;
}

export function containsProhibitedMemoryData(text: string): boolean {
	return [
		/\b(?:password|passcode|pin)\s*[:=]/i,
		/\b(?:api[-_ ]?key|client[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token)\s*[:=]/i,
		/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
		/\b(?:cvv|cvc)\s*[:=]/i,
		/\b(?:aadhaar|aadhar)\s*(?:number|no\.?|:)\s*\d{4}/i,
	].some((pattern) => pattern.test(text));
}

export async function recallMemoriContext(args: {
	readonly userId: string;
	readonly query: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<string[]> {
	if (!configuredMemori()) return [];
	const toolArgs: Record<string, unknown> = { query: args.query.slice(0, 4_000) };
	if (args.projectId) toolArgs.projectId = args.projectId;
	if (args.sessionId && args.projectId) toolArgs.sessionId = args.sessionId;
	try {
		const result = await callMemoriTool(args.userId, "memori_recall", toolArgs);
		const text = cleanRecallText(result);
		return text ? [text] : [];
	} catch (error) {
		console.warn("[AiraMemori] recall failed; continuing without external memory", {
			code: error instanceof Error ? error.name : "MEMORI_RECALL_FAILED",
		});
		return [];
	}
}

export async function persistMemoriTurn(args: {
	readonly userId: string;
	readonly userMessage: string;
	readonly assistantResponse: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<boolean> {
	if (!configuredMemori()) return false;
	if (containsProhibitedMemoryData(`${args.userMessage}\n${args.assistantResponse}`)) {
		console.info("[AiraMemori] durable write skipped by secret filter");
		return false;
	}
	const toolArgs: Record<string, unknown> = {
		user_message: args.userMessage.slice(0, MAX_WRITE_CHARS),
		assistant_response: args.assistantResponse.slice(0, MAX_WRITE_CHARS),
	};
	if (args.projectId) toolArgs.projectId = args.projectId;
	if (args.sessionId && args.projectId) toolArgs.sessionId = args.sessionId;
	try {
		await callMemoriTool(args.userId, "memori_advanced_augmentation", toolArgs);
		return true;
	} catch (error) {
		console.warn("[AiraMemori] augmentation failed; primary response remains successful", {
			code: error instanceof Error ? error.name : "MEMORI_WRITE_FAILED",
		});
		return false;
	}
}

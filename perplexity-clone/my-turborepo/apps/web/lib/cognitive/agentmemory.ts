import { createHmac } from "node:crypto";

const AGENTMEMORY_TIMEOUT_MS = 5_000;
const MAX_RECALL_CHARS = 8_000;
const MAX_RECALL_ITEM_CHARS = 1_800;
const MAX_RECALL_ITEMS = 6;
const MAX_RESPONSE_CHARS = 64_000;
const MAX_WRITE_CHARS = 12_000;

interface AgentMemoryConfig {
	readonly baseUrl: string;
	readonly secret: string;
	readonly entitySalt: string;
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function configuredAgentMemory(): AgentMemoryConfig | null {
	if (process.env.AIRA_AGENTMEMORY_ENABLED !== "true") return null;
	const secret = process.env.AIRA_AGENTMEMORY_SECRET?.trim();
	const entitySalt = process.env.AIRA_AGENTMEMORY_ENTITY_SALT?.trim();
	const rawUrl = process.env.AIRA_AGENTMEMORY_URL?.trim();
	if (!secret || secret.length < 24 || !entitySalt || entitySalt.length < 16 || !rawUrl) return null;

	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return null;
	}
	if (parsed.username || parsed.password || parsed.hash || parsed.search) return null;
	const localDevelopment = process.env.NODE_ENV === "development" && isLoopbackHost(parsed.hostname);
	if (parsed.protocol !== "https:" && !(localDevelopment && parsed.protocol === "http:")) return null;
	return {
		baseUrl: parsed.toString().replace(/\/+$/, ""),
		secret,
		entitySalt,
	};
}

/** Stable pseudonymous principal used as AgentMemory's explicit agentId filter. */
export function agentMemoryPrincipalId(userId: string, salt: string): string {
	const digest = createHmac("sha256", salt).update(`aira-user:${userId}`).digest("hex");
	return `aira_${digest.slice(0, 48)}`;
}

function projectScope(userId: string, projectId: string | undefined, salt: string): string {
	const digest = createHmac("sha256", salt)
		.update(`aira-project:${userId}:${projectId?.trim() || "global"}`)
		.digest("hex");
	return `aira_${digest.slice(0, 40)}`;
}

function endpointUrl(config: AgentMemoryConfig, path: string): string {
	const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
	return new URL(path.replace(/^\/+/, ""), base).toString();
}

async function postAgentMemory(
	config: AgentMemoryConfig,
	path: string,
	payload: Record<string, unknown>,
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), AGENTMEMORY_TIMEOUT_MS);
	try {
		const response = await globalThis.fetch(endpointUrl(config, path), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.secret}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
			cache: "no-store",
		});
		if (!response.ok) {
			throw new Error(`AgentMemory request failed with status ${response.status}.`);
		}
		const text = await response.text();
		if (text.length > MAX_RESPONSE_CHARS) throw new Error("AgentMemory response exceeded the safety limit.");
		return text ? (JSON.parse(text) as unknown) : null;
	} finally {
		clearTimeout(timer);
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
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

function recallItems(result: unknown, expectedAgentId: string): string[] {
	const root = asRecord(result);
	const rows = Array.isArray(root?.results) ? root.results : [];
	const recalled: string[] = [];
	let totalChars = 0;

	for (const row of rows.slice(0, MAX_RECALL_ITEMS * 3)) {
		const rowRecord = asRecord(row);
		const observation = asRecord(rowRecord?.observation);
		// Defense in depth: Aira never accepts an AgentMemory row unless the
		// upstream response carries the exact pseudonymous tenant principal.
		if (!observation || observation.agentId !== expectedAgentId) continue;
		const narrative = typeof observation.narrative === "string" ? observation.narrative : "";
		const facts = Array.isArray(observation.facts)
			? observation.facts.filter((item): item is string => typeof item === "string")
			: [];
		const cleaned = cleanRecallText(narrative || facts.join("\n"));
		if (!cleaned) continue;
		if (totalChars + cleaned.length > MAX_RECALL_CHARS) break;
		recalled.push(cleaned);
		totalChars += cleaned.length;
		if (recalled.length >= MAX_RECALL_ITEMS) break;
	}
	return recalled;
}

function memoryType(text: string): "preference" | "architecture" | "fact" {
	if (/\b(?:preference|prefer|from now on|going forward|always|default to)\b/i.test(text)) return "preference";
	if (/\b(?:architecture|stack|database|framework|project must)\b/i.test(text)) return "architecture";
	return "fact";
}

export function isAgentMemoryConfigured(): boolean {
	return configuredAgentMemory() !== null;
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

export async function recallAgentMemoryContext(args: {
	readonly userId: string;
	readonly query: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<string[]> {
	const config = configuredAgentMemory();
	if (!config) return [];
	const agentId = agentMemoryPrincipalId(args.userId, config.entitySalt);
	try {
		const result = await postAgentMemory(config, "agentmemory/search", {
			query: args.query.slice(0, 4_000),
			limit: MAX_RECALL_ITEMS * 3,
			agentId,
			project: projectScope(args.userId, args.projectId, config.entitySalt),
		});
		return recallItems(result, agentId);
	} catch (error) {
		console.warn("[AiraAgentMemory] recall failed; continuing without external memory", {
			code: error instanceof Error ? error.name : "AGENTMEMORY_RECALL_FAILED",
		});
		return [];
	}
}

export async function persistAgentMemoryTurn(args: {
	readonly userId: string;
	readonly userMessage: string;
	readonly assistantResponse: string;
	readonly projectId?: string;
	readonly sessionId?: string;
}): Promise<boolean> {
	const config = configuredAgentMemory();
	if (!config) return false;
	if (containsProhibitedMemoryData(`${args.userMessage}\n${args.assistantResponse}`)) {
		console.info("[AiraAgentMemory] durable write skipped by secret filter");
		return false;
	}

	const content = args.userMessage.trim().slice(0, MAX_WRITE_CHARS);
	if (!content) return false;
	const agentId = agentMemoryPrincipalId(args.userId, config.entitySalt);
	try {
		const result = await postAgentMemory(config, "agentmemory/remember", {
			content,
			type: memoryType(content),
			concepts: ["aira", "durable-user-memory"],
			agentId,
			project: projectScope(args.userId, args.projectId, config.entitySalt),
		});
		const root = asRecord(result);
		const memory = asRecord(root?.memory);
		// Fail closed if the server did not preserve the explicit tenant scope.
		return root?.success === true && memory?.agentId === agentId;
	} catch (error) {
		console.warn("[AiraAgentMemory] durable write failed; primary response remains successful", {
			code: error instanceof Error ? error.name : "AGENTMEMORY_WRITE_FAILED",
		});
		return false;
	}
}

import { randomUUID } from "node:crypto";

import {
	Client,
	ClientCredentialsProvider,
	StreamableHTTPClientTransport,
	type AuthProvider,
} from "@modelcontextprotocol/client";
import { z } from "zod";

import type { AgentTool, ToolRegistry } from "@/lib/agents/tools/tool-registry";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import { prisma } from "@/lib/prisma";
import type { PublicToolDescriptor, ToolPermissionClass } from "@/lib/tools/contracts";
import {
	getConfiguredMcpServer,
	getConfiguredMcpServers,
	isMcpEnabled,
	publicMcpAuth,
	readMcpSecret,
	type McpServerConfig,
} from "./config";
import { createMcpSafeFetch, McpNetworkError } from "./network";

const MAX_DISCOVERED_ITEMS = 64;
const DISCOVERY_CACHE_MS = 30_000;
const SAFE_TEXT_LIMIT = 600;

type McpServerState =
	| "NOT_CONFIGURED"
	| "CONFIGURED"
	| "AUTH_REQUIRED"
	| "PERMISSION_REQUIRED"
	| "AVAILABLE"
	| "DEGRADED"
	| "UNAVAILABLE";

export interface McpExecutionContext {
	readonly userId: string;
	readonly runId?: string;
	readonly toolCallId?: string;
}

export interface McpDiscoveredResource {
	readonly name: string;
	readonly title: string | null;
	readonly uri: string;
	readonly description: string | null;
	readonly mimeType: string | null;
}

export interface McpDiscoveredPrompt {
	readonly name: string;
	readonly title: string | null;
	readonly description: string | null;
}

export interface McpDiscoveredTool {
	readonly id: string;
	readonly remoteName: string;
	readonly label: string;
	readonly description: string;
	readonly permission: ToolPermissionClass;
	readonly inputSchema: unknown;
}

export interface McpDiscovery {
	readonly serverId: string;
	readonly tools: McpDiscoveredTool[];
	readonly resources: McpDiscoveredResource[];
	readonly prompts: McpDiscoveredPrompt[];
}

export interface PublicMcpServerStatus {
	readonly id: string;
	readonly label: string;
	readonly endpointHost: string;
	readonly enabled: boolean;
	readonly authMode: string;
	readonly scopes: string[];
	readonly state: McpServerState;
	readonly detail: string;
	readonly toolCount: number;
	readonly resourceCount: number;
	readonly promptCount: number;
	readonly tools: Array<Pick<McpDiscoveredTool, "id" | "label" | "permission">>;
	readonly resources: McpDiscoveredResource[];
	readonly prompts: McpDiscoveredPrompt[];
}

export class McpRuntimeError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "McpRuntimeError";
		this.code = code;
	}
}

const discoveryCache = new Map<string, { expiresAt: number; discovery: McpDiscovery }>();

function stripControlCharacters(value: string): string {
	let result = "";
	for (const character of value) {
		const code = character.charCodeAt(0);
		const blocked =
			(code >= 0 && code <= 8) ||
			code === 11 ||
			code === 12 ||
			(code >= 14 && code <= 31) ||
			code === 127;
		result += blocked ? " " : character;
	}
	return result;
}

function safeText(value: unknown, maxLength = SAFE_TEXT_LIMIT): string {
	if (typeof value !== "string") return "";
	return stripControlCharacters(value)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function safeJson(value: unknown, depth = 0): unknown {
	if (depth > 5) return null;
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return safeText(value, 1_000);
	if (Array.isArray(value)) return value.slice(0, 32).map((item) => safeJson(item, depth + 1));
	if (typeof value !== "object") return null;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value).slice(0, 48)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		result[safeText(key, 100)] = safeJson(child, depth + 1);
	}
	return result;
}

export function normalizeMcpToolName(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
	if (!normalized) throw new McpRuntimeError("MCP_TOOL_NAME_INVALID", "MCP tool name is invalid.");
	return normalized;
}

function canonicalToolId(serverId: string, remoteName: string): string {
	return `mcp:${serverId}:${normalizeMcpToolName(remoteName)}`;
}

function executionContext(value: unknown): McpExecutionContext | null {
	if (!value || typeof value !== "object") return null;
	const object = value as Record<string, unknown>;
	if (typeof object.userId !== "string" || !object.userId.trim()) return null;
	return {
		userId: object.userId,
		...(typeof object.runId === "string" && object.runId ? { runId: object.runId } : {}),
		...(typeof object.toolCallId === "string" && object.toolCallId ? { toolCallId: object.toolCallId } : {}),
	};
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new McpRuntimeError(code, "MCP operation timed out.")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function authProviderFor(server: McpServerConfig): AuthProvider | ClientCredentialsProvider | undefined {
	if (server.auth.mode === "none") return undefined;
	if (server.auth.mode === "bearer") {
		const token = readMcpSecret(server.auth.tokenEnv);
		if (!token) throw new McpRuntimeError("MCP_AUTH_REQUIRED", "MCP server credentials are not configured.");
		return { token: async () => token };
	}
	const clientId = readMcpSecret(server.auth.clientIdEnv);
	const clientSecret = readMcpSecret(server.auth.clientSecretEnv);
	if (!clientId || !clientSecret) {
		throw new McpRuntimeError("MCP_AUTH_REQUIRED", "MCP OAuth client credentials are not configured.");
	}
	return new ClientCredentialsProvider({
		clientId,
		clientSecret,
		clientName: "AIRA AI",
		...(server.auth.scopes.length ? { scope: server.auth.scopes.join(" ") } : {}),
		...(server.auth.expectedIssuer ? { expectedIssuer: server.auth.expectedIssuer } : {}),
	});
}

async function connectMcp(server: McpServerConfig): Promise<Client> {
	const client = new Client(
		{ name: "aira-ai", version: "1.0.0" },
		{ listMaxPages: 4, versionNegotiation: { mode: "auto" } },
	);
	const transport = new StreamableHTTPClientTransport(new URL(server.endpoint), {
		authProvider: authProviderFor(server),
		fetch: createMcpSafeFetch(server.timeoutMs),
	});
	try {
		await withTimeout(client.connect(transport), server.timeoutMs, "MCP_CONNECT_TIMEOUT");
		return client;
	} catch (error) {
		try {
			await withTimeout(client.close(), 2_000, "MCP_CLOSE_TIMEOUT");
		} catch {
			// Connection teardown is best-effort after a failed handshake.
		}
		if (error instanceof McpRuntimeError || error instanceof McpNetworkError) throw error;
		throw new McpRuntimeError("MCP_CONNECT_FAILED", "MCP server connection failed.");
	}
}

async function closeMcp(client: Client): Promise<void> {
	try {
		await withTimeout(client.close(), 2_000, "MCP_CLOSE_TIMEOUT");
	} catch {
		// Do not turn a completed discovery/tool call into an error because teardown failed.
	}
}

function createTool(
	server: McpServerConfig,
	discovered: McpDiscoveredTool,
): AgentTool<Record<string, unknown>, unknown, McpExecutionContext> {
	return {
		name: discovered.id,
		label: discovered.label,
		description: discovered.description,
		category: "mcp",
		requiresAuth: true,
		requiresPermission: discovered.permission !== "READ",
		permission: discovered.permission,
		timeoutMs: server.timeoutMs,
		cancellable: true,
		audit: discovered.permission === "READ" ? "standard" : "required",
		availability: {
			state: "AVAILABLE",
			detail: `Live discovery succeeded for ${server.label}.`,
		},
		publicInputSchema: discovered.inputSchema,
		provenance: { kind: "mcp", serverId: server.id },
		inputSchema: z.record(z.string(), z.unknown()),
		execute: async (input, context) => executeMcpTool(server, discovered, input, context),
	};
}

function publicDescriptor(server: McpServerConfig, tool: McpDiscoveredTool): PublicToolDescriptor {
	return {
		id: tool.id,
		label: tool.label,
		description: tool.description,
		category: "mcp",
		permission: tool.permission,
		sideEffecting: tool.permission !== "READ",
		timeoutMs: server.timeoutMs,
		cancellable: true,
		audit: tool.permission === "READ" ? "standard" : "required",
		availability: { state: "AVAILABLE", detail: `Live discovery succeeded for ${server.label}.` },
		inputSchema: tool.inputSchema,
		provenance: { kind: "mcp", serverId: server.id },
	};
}

async function preferenceEnabled(userId: string, server: McpServerConfig): Promise<boolean> {
	if (!server.enabled) return false;
	const preference = await prisma.mcpServerPreference.findUnique({
		where: { userId_serverId: { userId, serverId: server.id } },
		select: { enabled: true },
	});
	return preference?.enabled ?? true;
}

export async function setMcpServerEnabled(
	userId: string,
	serverId: string,
	enabled: boolean,
): Promise<boolean> {
	const server = getConfiguredMcpServer(serverId);
	if (!server) throw new McpRuntimeError("MCP_SERVER_NOT_FOUND", "MCP server is not configured.");
	if (enabled && (!isMcpEnabled() || !server.enabled)) {
		throw new McpRuntimeError("MCP_SERVER_DISABLED", "MCP server is disabled by deployment policy.");
	}
	const preference = await prisma.mcpServerPreference.upsert({
		where: { userId_serverId: { userId, serverId } },
		create: { userId, serverId, enabled },
		update: { enabled },
		select: { enabled: true },
	});
	return preference.enabled;
}

export async function discoverMcpServer(server: McpServerConfig): Promise<McpDiscovery> {
	const cached = discoveryCache.get(server.id);
	if (cached && cached.expiresAt > Date.now()) return cached.discovery;

	const auth = publicMcpAuth(server);
	if (!auth.configured) throw new McpRuntimeError("MCP_AUTH_REQUIRED", "MCP server credentials are not configured.");

	const client = await connectMcp(server);
	try {
		const capabilities = client.getServerCapabilities();
		const [toolResult, resourceResult, promptResult] = await Promise.all([
			capabilities?.tools
				? withTimeout(client.listTools(), server.timeoutMs, "MCP_DISCOVERY_TIMEOUT")
				: Promise.resolve({ tools: [] }),
			capabilities?.resources
				? withTimeout(client.listResources(), server.timeoutMs, "MCP_DISCOVERY_TIMEOUT")
				: Promise.resolve({ resources: [] }),
			capabilities?.prompts
				? withTimeout(client.listPrompts(), server.timeoutMs, "MCP_DISCOVERY_TIMEOUT")
				: Promise.resolve({ prompts: [] }),
		]);

		const seenToolIds = new Set<string>();
		const tools: McpDiscoveredTool[] = [];
		for (const remote of toolResult.tools.slice(0, MAX_DISCOVERED_ITEMS)) {
			const remoteName = safeText(remote.name, 128);
			if (!remoteName) continue;
			const id = canonicalToolId(server.id, remoteName);
			if (seenToolIds.has(id)) {
				throw new McpRuntimeError("MCP_TOOL_COLLISION", "MCP server published ambiguous tool names.");
			}
			seenToolIds.add(id);
			const permission: ToolPermissionClass = server.readOnlyTools.includes(remoteName) ? "READ" : "HIGH_IMPACT";
			tools.push({
				id,
				remoteName,
				label: safeText(remote.title, 100) || remoteName,
				description: safeText(remote.description) || `Remote MCP tool from ${server.label}.`,
				permission,
				inputSchema: safeJson(remote.inputSchema),
			});
		}

		const resources: McpDiscoveredResource[] = resourceResult.resources
			.slice(0, MAX_DISCOVERED_ITEMS)
			.map((resource) => ({
				name: safeText(resource.name, 128),
				title: safeText(resource.title, 120) || null,
				uri: safeText(resource.uri, 500),
				description: safeText(resource.description) || null,
				mimeType: safeText(resource.mimeType, 120) || null,
			}))
			.filter((resource) => Boolean(resource.name && resource.uri));
		const prompts: McpDiscoveredPrompt[] = promptResult.prompts
			.slice(0, MAX_DISCOVERED_ITEMS)
			.map((prompt) => ({
				name: safeText(prompt.name, 128),
				title: safeText(prompt.title, 120) || null,
				description: safeText(prompt.description) || null,
			}))
			.filter((prompt) => Boolean(prompt.name));

		const discovery = { serverId: server.id, tools, resources, prompts } satisfies McpDiscovery;
		discoveryCache.set(server.id, { expiresAt: Date.now() + DISCOVERY_CACHE_MS, discovery });
		return discovery;
	} catch (error) {
		if (error instanceof McpRuntimeError || error instanceof McpNetworkError) throw error;
		throw new McpRuntimeError("MCP_DISCOVERY_FAILED", "MCP capability discovery failed.");
	} finally {
		await closeMcp(client);
	}
}

async function executeMcpTool(
	server: McpServerConfig,
	tool: McpDiscoveredTool,
	input: Record<string, unknown>,
	contextValue?: McpExecutionContext,
): Promise<unknown> {
	const context = executionContext(contextValue);
	if (!context) throw new McpRuntimeError("MCP_CONTEXT_REQUIRED", "MCP execution requires an authenticated AIRA user context.");
	if (!(await preferenceEnabled(context.userId, server))) {
		throw new McpRuntimeError("MCP_SERVER_DISABLED", "MCP server is disabled for this account.");
	}
	const callId = safeText(context.toolCallId, 100) || randomUUID();
	if (context.runId) {
		await recordAgentRunEventBestEffort({
			runId: context.runId,
			eventKey: `mcp:${callId}:connecting`,
			type: "MCP_SERVER_CONNECTING",
			message: `Connecting to MCP server ${server.label}.`,
			metadata: { serverId: server.id, toolId: tool.id },
		});
	}

	let client: Client | null = null;
	try {
		client = await connectMcp(server);
		if (context.runId) {
			await recordAgentRunEventBestEffort({
				runId: context.runId,
				eventKey: `mcp:${callId}:connected`,
				type: "MCP_SERVER_CONNECTED",
				message: `MCP server ${server.label} accepted the connection.`,
				metadata: { serverId: server.id, toolId: tool.id },
			});
			await recordAgentRunEventBestEffort({
				runId: context.runId,
				eventKey: `mcp:${callId}:tool-started`,
				type: "MCP_TOOL_STARTED",
				message: `MCP tool ${tool.label} started.`,
				metadata: { serverId: server.id, toolId: tool.id },
			});
		}

		const result = await withTimeout(
			client.callTool({ name: tool.remoteName, arguments: input }),
			server.timeoutMs,
			"MCP_TOOL_TIMEOUT",
		);
		const serialized = JSON.stringify(result);
		if (Buffer.byteLength(serialized, "utf8") > server.maxOutputBytes) {
			throw new McpRuntimeError("MCP_OUTPUT_TOO_LARGE", "MCP tool output exceeded the configured safety bound.");
		}
		if (result.isError) {
			throw new McpRuntimeError("MCP_TOOL_FAILED", "MCP tool returned an error result.");
		}
		if (context.runId) {
			await recordAgentRunEventBestEffort({
				runId: context.runId,
				eventKey: `mcp:${callId}:tool-completed`,
				type: "MCP_TOOL_COMPLETED",
				message: `MCP tool ${tool.label} completed.`,
				metadata: { serverId: server.id, toolId: tool.id },
			});
		}
		return result;
	} catch (error) {
		if (context.runId) {
			await recordAgentRunEventBestEffort({
				runId: context.runId,
				eventKey: `mcp:${callId}:failed`,
				type: client ? "MCP_TOOL_FAILED" : "MCP_SERVER_FAILED",
				message: client ? `MCP tool ${tool.label} failed.` : `MCP server ${server.label} connection failed.`,
				metadata: { serverId: server.id, toolId: tool.id },
			});
		}
		if (error instanceof McpRuntimeError || error instanceof McpNetworkError) throw error;
		throw new McpRuntimeError("MCP_TOOL_FAILED", "MCP tool invocation failed.");
	} finally {
		if (client) await closeMcp(client);
	}
}

export async function registerConfiguredMcpToolsForUser(
	registry: ToolRegistry,
	userId: string,
): Promise<PublicToolDescriptor[]> {
	if (!isMcpEnabled()) return [];
	const descriptors: PublicToolDescriptor[] = [];
	for (const server of getConfiguredMcpServers()) {
		if (!(await preferenceEnabled(userId, server))) continue;
		if (!publicMcpAuth(server).configured) continue;
		try {
			const discovery = await discoverMcpServer(server);
			for (const tool of discovery.tools) {
				registry.registerTool(createTool(server, tool));
				descriptors.push(publicDescriptor(server, tool));
			}
		} catch (error) {
			console.error("[mcp:discovery]", {
				serverId: server.id,
				code: error instanceof McpRuntimeError || error instanceof McpNetworkError ? error.code : "MCP_DISCOVERY_FAILED",
			});
		}
	}
	return descriptors;
}

export async function ensureMcpToolRegistered(
	registry: ToolRegistry,
	canonicalId: string,
	userId: string | null,
): Promise<void> {
	if (!userId) throw new McpRuntimeError("MCP_CONTEXT_REQUIRED", "MCP execution requires an authenticated AIRA user context.");
	const match = canonicalId.match(/^mcp:([a-z0-9][a-z0-9_-]{0,47}):(.+)$/);
	if (!match) throw new McpRuntimeError("MCP_TOOL_NOT_FOUND", "MCP tool identifier is invalid.");
	const server = getConfiguredMcpServer(match[1]);
	if (!server || !isMcpEnabled() || !(await preferenceEnabled(userId, server))) {
		throw new McpRuntimeError("MCP_SERVER_DISABLED", "MCP server is unavailable for this account.");
	}
	const discovery = await discoverMcpServer(server);
	const tool = discovery.tools.find((candidate) => candidate.id === canonicalId);
	if (!tool) throw new McpRuntimeError("MCP_TOOL_NOT_FOUND", "MCP tool is no longer published by the server.");
	registry.registerTool(createTool(server, tool));
}

export async function getMcpServerStatuses(userId: string): Promise<PublicMcpServerStatus[]> {
	const globallyEnabled = isMcpEnabled();
	const statuses: PublicMcpServerStatus[] = [];
	for (const server of getConfiguredMcpServers()) {
		const auth = publicMcpAuth(server);
		const enabled = globallyEnabled && (await preferenceEnabled(userId, server));
		const base = {
			id: server.id,
			label: server.label,
			endpointHost: new URL(server.endpoint).host,
			enabled,
			authMode: auth.mode,
			scopes: auth.scopes,
		};
		if (!globallyEnabled) {
			statuses.push({ ...base, state: "NOT_CONFIGURED", detail: "MCP is disabled for this deployment.", toolCount: 0, resourceCount: 0, promptCount: 0, tools: [], resources: [], prompts: [] });
			continue;
		}
		if (!enabled) {
			statuses.push({ ...base, state: "UNAVAILABLE", detail: "MCP server is disabled for this account or by deployment policy.", toolCount: 0, resourceCount: 0, promptCount: 0, tools: [], resources: [], prompts: [] });
			continue;
		}
		if (!auth.configured) {
			statuses.push({ ...base, state: "AUTH_REQUIRED", detail: "Server-side MCP credentials are required.", toolCount: 0, resourceCount: 0, promptCount: 0, tools: [], resources: [], prompts: [] });
			continue;
		}
		try {
			const discovery = await discoverMcpServer(server);
			statuses.push({
				...base,
				state: "AVAILABLE",
				detail: "Live MCP discovery succeeded.",
				toolCount: discovery.tools.length,
				resourceCount: discovery.resources.length,
				promptCount: discovery.prompts.length,
				tools: discovery.tools.map(({ id, label, permission }) => ({ id, label, permission })),
				resources: discovery.resources,
				prompts: discovery.prompts,
			});
		} catch (error) {
			statuses.push({
				...base,
				state: "DEGRADED",
				detail: error instanceof McpRuntimeError && error.code === "MCP_AUTH_REQUIRED" ? "MCP authentication is required." : "Live MCP discovery failed.",
				toolCount: 0,
				resourceCount: 0,
				promptCount: 0,
				tools: [],
				resources: [],
				prompts: [],
			});
		}
	}
	return statuses;
}

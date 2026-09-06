import { z } from "zod";

import { validateMcpEndpoint } from "./network";

const MAX_MCP_SERVERS = 16;
const MAX_READ_ONLY_TOOLS = 64;
const MAX_SCOPES = 32;
const SECRET_ENV_PATTERN = /^AIRA_MCP_SECRET_[A-Z0-9_]{1,80}$/;

const SecretEnvSchema = z.string().trim().regex(SECRET_ENV_PATTERN);
const AuthSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("none") }),
	z.object({
		mode: z.literal("bearer"),
		tokenEnv: SecretEnvSchema,
	}),
	z.object({
		mode: z.literal("oauth_client_credentials"),
		clientIdEnv: SecretEnvSchema,
		clientSecretEnv: SecretEnvSchema,
		scopes: z.array(z.string().trim().min(1).max(160)).max(MAX_SCOPES).default([]),
		expectedIssuer: z.string().trim().url().optional(),
	}),
]);

const ServerSchema = z.object({
	id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
	label: z.string().trim().min(1).max(80),
	endpoint: z.string().trim().url(),
	enabled: z.boolean().default(true),
	auth: AuthSchema.default({ mode: "none" }),
	readOnlyTools: z.array(z.string().trim().min(1).max(128)).max(MAX_READ_ONLY_TOOLS).default([]),
	timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
	maxOutputBytes: z.number().int().min(1_024).max(262_144).default(65_536),
});

export type McpServerConfig = z.infer<typeof ServerSchema>;
export type McpAuthConfig = McpServerConfig["auth"];

export class McpConfigError extends Error {
	readonly code = "MCP_CONFIG_INVALID";

	constructor(message = "MCP server configuration is invalid.") {
		super(message);
		this.name = "McpConfigError";
	}
}

function dedupe(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}

export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
	if (!raw?.trim()) return [];

	let decoded: unknown;
	try {
		decoded = JSON.parse(raw);
	} catch {
		throw new McpConfigError();
	}

	const parsed = z.array(ServerSchema).max(MAX_MCP_SERVERS).safeParse(decoded);
	if (!parsed.success) throw new McpConfigError();

	const ids = new Set<string>();
	return parsed.data.map((server) => {
		if (ids.has(server.id)) throw new McpConfigError("MCP server IDs must be unique.");
		ids.add(server.id);
		validateMcpEndpoint(server.endpoint);
		if (server.auth.mode === "oauth_client_credentials" && server.auth.expectedIssuer) {
			validateMcpEndpoint(server.auth.expectedIssuer, { allowPath: false });
		}
		return {
			...server,
			readOnlyTools: dedupe(server.readOnlyTools),
			...(server.auth.mode === "oauth_client_credentials"
				? { auth: { ...server.auth, scopes: dedupe(server.auth.scopes) } }
				: {}),
		};
	});
}

export function isMcpEnabled(): boolean {
	return process.env.AIRA_MCP_ENABLED === "true";
}

export function getConfiguredMcpServers(): McpServerConfig[] {
	return parseMcpServers(process.env.AIRA_MCP_SERVERS_JSON);
}

export function getConfiguredMcpServer(serverId: string): McpServerConfig | null {
	return getConfiguredMcpServers().find((server) => server.id === serverId) ?? null;
}

export function readMcpSecret(envName: string): string | null {
	if (!SECRET_ENV_PATTERN.test(envName)) return null;
	return process.env[envName]?.trim() || null;
}

export function publicMcpAuth(server: McpServerConfig): {
	mode: McpAuthConfig["mode"];
	scopes: string[];
	configured: boolean;
} {
	if (server.auth.mode === "none") {
		return { mode: "none", scopes: [], configured: true };
	}
	if (server.auth.mode === "bearer") {
		return {
			mode: "bearer",
			scopes: [],
			configured: Boolean(readMcpSecret(server.auth.tokenEnv)),
		};
	}
	return {
		mode: "oauth_client_credentials",
		scopes: server.auth.scopes,
		configured: Boolean(
			readMcpSecret(server.auth.clientIdEnv) && readMcpSecret(server.auth.clientSecretEnv),
		),
	};
}

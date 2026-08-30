import { Pool } from "pg";
import { z } from "zod";

import type { ToolAdapter, ToolContext } from "./types";
import { ToolGatewayError } from "./types";

function enabled(name: string): boolean {
	return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new ToolGatewayError({ code: "TOOL_NOT_CONFIGURED", message: `${name} is not configured.`, status: 503 });
	return value;
}

function safeObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function safeIdentifier(value: string, label: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value)) {
		throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: `${label} is not a safe SQL identifier.`, status: 400 });
	}
	return `"${value.replaceAll('"', '""')}"`;
}

function safeRepoPath(value: string): string {
	const path = value.replaceAll("\\", "/").replace(/^\/+/, "");
	const parts = path.split("/").filter(Boolean);
	if (!parts.length || parts.includes("..") || parts.includes(".git") || path.includes("\0") || path.length > 1_024) {
		throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Repository path is outside the allowed scope.", status: 400 });
	}
	return parts.join("/");
}

function missionBranch(context: ToolContext): string {
	return `aira/${context.runId.slice(0, 8)}/${(context.taskId ?? "manager").slice(0, 8)}`;
}

const DEFAULT_EXTERNAL_RESPONSE_BYTES = 2_000_000;
export const MCP_MAX_ARGUMENT_BYTES = 262_144;
export const MCP_MAX_RESPONSE_BYTES = 524_288;
export const UNTRUSTED_MCP_CONTENT = "UNTRUSTED_EXTERNAL_CONTENT" as const;
const MCP_MAX_ARGUMENT_DEPTH = 20;
const MCP_MAX_ARGUMENT_NODES = 5_000;

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
	const declared = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new ToolGatewayError({ code: "EXTERNAL_TOOL_RESPONSE_TOO_LARGE", message: "External tool response exceeded the allowed size.", status: 502 });
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new ToolGatewayError({ code: "EXTERNAL_TOOL_RESPONSE_TOO_LARGE", message: "External tool response exceeded the allowed size.", status: 502 });
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} finally {
		reader.releaseLock();
	}
}

async function jsonFetch(
	url: string,
	init: RequestInit,
	options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number; readonly strictJson?: boolean } = {},
): Promise<unknown> {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_EXTERNAL_RESPONSE_BYTES;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
		const text = await boundedResponseText(response, maxResponseBytes);
		if (!response.ok) {
			throw new ToolGatewayError({
				code: "EXTERNAL_TOOL_REQUEST_FAILED",
				message: `External tool returned HTTP ${response.status}.`,
				status: response.status === 401 || response.status === 403 ? 502 : Math.min(599, Math.max(400, response.status)),
				retryable: response.status === 408 || response.status === 429 || response.status >= 500,
			});
		}
		if (!text) return {};
		try {
			return JSON.parse(text) as unknown;
		} catch {
			if (options.strictJson) {
				throw new ToolGatewayError({ code: "EXTERNAL_TOOL_RESPONSE_INVALID", message: "External tool returned an invalid JSON response.", status: 502 });
			}
			return { text: text.slice(0, 2_000) };
		}
	} catch (error) {
		if (error instanceof ToolGatewayError) throw error;
		throw new ToolGatewayError({ code: "EXTERNAL_TOOL_UNREACHABLE", message: "External tool endpoint is temporarily unreachable.", status: 503, retryable: true });
	} finally {
		clearTimeout(timer);
	}
}

export function serializeMcpArguments(value: Record<string, unknown>): string {
	const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
	const seen = new Set<object>();
	let nodes = 0;
	let approximateBytes = 2;
	while (stack.length) {
		const current = stack.pop()!;
		nodes += 1;
		if (nodes > MCP_MAX_ARGUMENT_NODES || current.depth > MCP_MAX_ARGUMENT_DEPTH) {
			throw new ToolGatewayError({ code: "MCP_ARGUMENTS_TOO_COMPLEX", message: "MCP arguments exceed the allowed structural complexity.", status: 400 });
		}
		const currentValue = current.value;
		if (typeof currentValue === "string") {
			approximateBytes += Buffer.byteLength(currentValue, "utf8") + 2;
		} else if (typeof currentValue === "number") {
			if (!Number.isFinite(currentValue)) throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP arguments must be JSON-compatible.", status: 400 });
			approximateBytes += 32;
		} else if (typeof currentValue === "boolean" || currentValue === null) {
			approximateBytes += 5;
		} else if (Array.isArray(currentValue)) {
			if (seen.has(currentValue)) throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP arguments must not contain cycles.", status: 400 });
			seen.add(currentValue);
			approximateBytes += currentValue.length + 2;
			for (const child of currentValue) stack.push({ value: child, depth: current.depth + 1 });
		} else if (currentValue && typeof currentValue === "object") {
			if (seen.has(currentValue)) throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP arguments must not contain cycles.", status: 400 });
			const prototype = Object.getPrototypeOf(currentValue);
			if (prototype !== Object.prototype && prototype !== null) throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP arguments must be plain JSON objects.", status: 400 });
			seen.add(currentValue);
			const entries = Object.entries(currentValue as Record<string, unknown>);
			approximateBytes += entries.length + 2;
			for (const [key, child] of entries) {
				if (key.length > 200) throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP argument keys are too long.", status: 400 });
				approximateBytes += Buffer.byteLength(key, "utf8") + 3;
				stack.push({ value: child, depth: current.depth + 1 });
			}
		} else {
			throw new ToolGatewayError({ code: "MCP_ARGUMENTS_INVALID", message: "MCP arguments must be JSON-compatible.", status: 400 });
		}
		if (approximateBytes > MCP_MAX_ARGUMENT_BYTES) {
			throw new ToolGatewayError({ code: "MCP_ARGUMENTS_TOO_LARGE", message: "MCP arguments exceed the allowed size.", status: 400 });
		}
	}
	const serialized = JSON.stringify(value);
	if (Buffer.byteLength(serialized, "utf8") > MCP_MAX_ARGUMENT_BYTES) {
		throw new ToolGatewayError({ code: "MCP_ARGUMENTS_TOO_LARGE", message: "MCP arguments exceed the allowed size.", status: 400 });
	}
	return serialized;
}

// ---------------------------------------------------------------------------
// GitHub — one server-owned repository. The model cannot choose owner/repo or
// arbitrary branches. All writable branches are derived from the mission.
// ---------------------------------------------------------------------------
const GitHubReadSchema = z.object({
	resource: z.enum(["repo", "file", "pull_request", "checks"]),
	path: z.string().max(1_024).optional(),
	pullNumber: z.number().int().positive().optional(),
	scope: z.enum(["base", "mission"]).default("base"),
});
const GitHubCommitSchema = z.object({
	path: z.string().min(1).max(1_024),
	content: z.string().max(750_000),
	message: z.string().trim().min(1).max(500),
});
const GitHubPrSchema = z.object({
	title: z.string().trim().min(1).max(240),
	body: z.string().max(20_000).default(""),
});
const GitHubCommentSchema = z.object({ pullNumber: z.number().int().positive(), body: z.string().trim().min(1).max(20_000) });

function githubConfig(): { token: string; repository: string; baseBranch: string; api: string } {
	const repository = requiredEnv("AIRA_GITHUB_REPOSITORY");
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new ToolGatewayError({ code: "GITHUB_SCOPE_INVALID", message: "AIRA_GITHUB_REPOSITORY is invalid.", status: 503 });
	return {
		token: requiredEnv("AIRA_GITHUB_TOKEN"),
		repository,
		baseBranch: process.env.AIRA_GITHUB_BASE_BRANCH?.trim() || "main",
		api: (process.env.AIRA_GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/, ""),
	};
}

async function githubRequest(path: string, init: RequestInit = {}): Promise<unknown> {
	const config = githubConfig();
	return jsonFetch(`${config.api}/repos/${config.repository}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${config.token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...(init.headers ?? {}),
		},
	});
}

export const githubToolAdapter: ToolAdapter = {
	id: "github",
	async isAvailable() {
		return enabled("AIRA_GITHUB_TOOL_ENABLED") && Boolean(process.env.AIRA_GITHUB_TOKEN?.trim() && process.env.AIRA_GITHUB_REPOSITORY?.trim());
	},
	async execute(context, action, input) {
		const cfg = githubConfig();
		const branch = missionBranch(context);
		if (branch === cfg.baseBranch || branch === "main" || branch === "master") {
			throw new ToolGatewayError({ code: "GITHUB_PROTECTED_BRANCH", message: "Mission branches cannot resolve to the protected base branch.", status: 403 });
		}
		if (action === "read") {
			const parsed = GitHubReadSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "GitHub read input is invalid.", status: 400 });
			if (parsed.data.resource === "repo") return { result: safeObject(await githubRequest("")) };
			const ref = parsed.data.scope === "mission" ? branch : cfg.baseBranch;
			if (parsed.data.resource === "file") {
				if (!parsed.data.path) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "GitHub file read requires path.", status: 400 });
				const value = safeObject(await githubRequest(`/contents/${safeRepoPath(parsed.data.path)}?ref=${encodeURIComponent(ref)}`));
				const encoded = typeof value.content === "string" ? value.content.replace(/\s/g, "") : "";
				return { result: { path: value.path, sha: value.sha, ref, content: encoded ? Buffer.from(encoded, "base64").toString("utf8").slice(0, 500_000) : "" } };
			}
			if (parsed.data.resource === "pull_request") {
				if (!parsed.data.pullNumber) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Pull request read requires pullNumber.", status: 400 });
				return { result: safeObject(await githubRequest(`/pulls/${parsed.data.pullNumber}`)) };
			}
			return { result: safeObject(await githubRequest(`/commits/${encodeURIComponent(ref)}/check-runs`)) };
		}
		if (action === "create_branch") {
			const base = safeObject(await githubRequest(`/git/ref/heads/${encodeURIComponent(cfg.baseBranch)}`));
			const object = safeObject(base.object);
			if (typeof object.sha !== "string") throw new ToolGatewayError({ code: "GITHUB_BASE_REF_INVALID", message: "Could not resolve the configured GitHub base branch.", status: 502 });
			try {
				return { result: safeObject(await githubRequest("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }) })) };
			} catch (error) {
				if (error instanceof ToolGatewayError && error.status === 422) return { result: safeObject(await githubRequest(`/git/ref/heads/${encodeURIComponent(branch)}`)) };
				throw error;
			}
		}
		if (action === "create_commit") {
			const parsed = GitHubCommitSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "GitHub commit input is invalid.", status: 400 });
			const path = safeRepoPath(parsed.data.path);
			let sha: string | undefined;
			try {
				const current = safeObject(await githubRequest(`/contents/${path}?ref=${encodeURIComponent(branch)}`));
				if (typeof current.sha === "string") sha = current.sha;
			} catch (error) {
				if (!(error instanceof ToolGatewayError && error.status === 404)) throw error;
			}
			return { result: safeObject(await githubRequest(`/contents/${path}`, {
				method: "PUT",
				body: JSON.stringify({ message: parsed.data.message, content: Buffer.from(parsed.data.content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }),
			})) };
		}
		if (action === "create_pr") {
			const parsed = GitHubPrSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Pull request input is invalid.", status: 400 });
			return { result: safeObject(await githubRequest("/pulls", { method: "POST", body: JSON.stringify({ title: parsed.data.title, body: parsed.data.body, head: branch, base: cfg.baseBranch }) })) };
		}
		if (action === "comment") {
			const parsed = GitHubCommentSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "GitHub comment input is invalid.", status: 400 });
			return { result: safeObject(await githubRequest(`/issues/${parsed.data.pullNumber}/comments`, { method: "POST", body: JSON.stringify({ body: parsed.data.body }) })) };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `GitHub action ${action} is not exposed. Protected branch merges, force-push and branch-protection changes are intentionally unavailable.`, status: 409 });
	},
};

// ---------------------------------------------------------------------------
// Vercel — fixed project/team. Preview creation is allowed only from the
// server-derived mission branch; production promotion/env changes are omitted.
// ---------------------------------------------------------------------------
const VercelReadSchema = z.object({
	resource: z.enum(["project", "deployments", "deployment", "build_logs"]),
	deploymentId: z.string().min(3).max(300).optional(),
	limit: z.number().int().min(1).max(100).default(20),
});

function vercelConfig(): { token: string; projectId: string; teamId?: string; projectName?: string; githubRepoId?: number } {
	const repo = process.env.AIRA_VERCEL_GITHUB_REPO_ID?.trim();
	return {
		token: requiredEnv("AIRA_VERCEL_TOKEN"),
		projectId: requiredEnv("AIRA_VERCEL_PROJECT_ID"),
		teamId: process.env.AIRA_VERCEL_TEAM_ID?.trim() || undefined,
		projectName: process.env.AIRA_VERCEL_PROJECT_NAME?.trim() || undefined,
		githubRepoId: repo && /^\d+$/.test(repo) ? Number(repo) : undefined,
	};
}

async function vercelRequest(path: string, init: RequestInit = {}): Promise<unknown> {
	const cfg = vercelConfig();
	const url = new URL(`https://api.vercel.com${path}`);
	if (cfg.teamId) url.searchParams.set("teamId", cfg.teamId);
	return jsonFetch(url.toString(), {
		...init,
		headers: { Authorization: `Bearer ${cfg.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
	}, { timeoutMs: 30_000 });
}

export const vercelToolAdapter: ToolAdapter = {
	id: "vercel",
	async isAvailable() {
		return enabled("AIRA_VERCEL_TOOL_ENABLED") && Boolean(process.env.AIRA_VERCEL_TOKEN?.trim() && process.env.AIRA_VERCEL_PROJECT_ID?.trim());
	},
	async execute(context, action, input) {
		const cfg = vercelConfig();
		if (action === "read") {
			const parsed = VercelReadSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Vercel read input is invalid.", status: 400 });
			if (parsed.data.resource === "project") return { result: safeObject(await vercelRequest(`/v9/projects/${encodeURIComponent(cfg.projectId)}`)) };
			if (parsed.data.resource === "deployments") return { result: safeObject(await vercelRequest(`/v6/deployments?projectId=${encodeURIComponent(cfg.projectId)}&limit=${parsed.data.limit}`)) };
			if (!parsed.data.deploymentId) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "deploymentId is required.", status: 400 });
			if (parsed.data.resource === "build_logs") {
				const value = await vercelRequest(`/v3/deployments/${encodeURIComponent(parsed.data.deploymentId)}/events?limit=${parsed.data.limit}&follow=0`);
				return { result: { events: Array.isArray(value) ? value.slice(0, parsed.data.limit) : value } as Record<string, unknown> };
			}
			return { result: safeObject(await vercelRequest(`/v13/deployments/${encodeURIComponent(parsed.data.deploymentId)}`)) };
		}
		if (action === "preview_deploy") {
			if (!cfg.githubRepoId) throw new ToolGatewayError({ code: "VERCEL_GIT_SOURCE_NOT_CONFIGURED", message: "Preview deployment requires AIRA_VERCEL_GITHUB_REPO_ID.", status: 503 });
			const branch = missionBranch(context);
			const body = {
				name: cfg.projectName,
				project: cfg.projectId,
				gitSource: { type: "github", repoId: cfg.githubRepoId, ref: branch },
				meta: { airaRunId: context.runId, airaTaskId: context.taskId ?? "manager" },
			};
			return { result: safeObject(await vercelRequest("/v13/deployments", { method: "POST", body: JSON.stringify(body) })) };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Vercel action ${action} is not exposed. Production promotion, env mutation and deletion remain protected owner actions.`, status: 409 });
	},
};

// ---------------------------------------------------------------------------
// Supabase/Postgres — fixed database URL. No arbitrary SQL. Read queries are
// generated from identifiers + parameterized values; optional dev writes allow
// INSERT only and are disabled for production environments.
// ---------------------------------------------------------------------------
let supabasePool: Pool | null = null;
function dbPool(): Pool {
	if (!supabasePool) {
		supabasePool = new Pool({ connectionString: requiredEnv("AIRA_SUPABASE_TOOL_DATABASE_URL"), max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
	}
	return supabasePool;
}
const ScalarSchema = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]);
const SupabaseSelectSchema = z.object({
	schema: z.string().default("public"),
	table: z.string().min(1).max(63),
	columns: z.array(z.string().min(1).max(63)).min(1).max(30).default(["id"]),
	filters: z.record(z.string(), ScalarSchema).default({}),
	limit: z.number().int().min(1).max(200).default(50),
});
const SupabaseInsertSchema = z.object({
	schema: z.string().default("public"),
	table: z.string().min(1).max(63),
	values: z.record(z.string(), ScalarSchema).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 30),
});

export const supabaseToolAdapter: ToolAdapter = {
	id: "supabase",
	async isAvailable() { return enabled("AIRA_SUPABASE_TOOL_ENABLED") && Boolean(process.env.AIRA_SUPABASE_TOOL_DATABASE_URL?.trim()); },
	async execute(_context, action, input) {
		const pool = dbPool();
		if (action === "read") {
			const client = await pool.connect();
			try {
				await client.query("BEGIN READ ONLY");
				const summary = await client.query<{ database: string; user: string }>("select current_database() as database, current_user as user");
				await client.query("COMMIT");
				return { result: { database: summary.rows[0]?.database, role: summary.rows[0]?.user, environment: process.env.AIRA_SUPABASE_TOOL_ENVIRONMENT ?? "unspecified", writesEnabled: enabled("AIRA_SUPABASE_TOOL_ALLOW_WRITES") && !/^prod(?:uction)?$/i.test(process.env.AIRA_SUPABASE_TOOL_ENVIRONMENT ?? "") } };
			} catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
		}
		if (action === "inspect_schema") {
			const result = await pool.query(`select table_schema,table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by table_schema,table_name,ordinal_position limit 2000`);
			return { result: { columns: result.rows } };
		}
		if (action === "read_migrations") {
			try {
				const result = await pool.query(`select version,statements,name from supabase_migrations.schema_migrations order by version desc limit 100`);
				return { result: { migrations: result.rows } };
			} catch {
				return { result: { migrations: [], available: false } };
			}
		}
		if (action === "query_readonly") {
			const parsed = SupabaseSelectSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Supabase select input is invalid.", status: 400 });
			const schema = safeIdentifier(parsed.data.schema, "schema");
			const table = safeIdentifier(parsed.data.table, "table");
			const columns = parsed.data.columns.map((column) => safeIdentifier(column, "column")).join(",");
			const filterEntries = Object.entries(parsed.data.filters);
			const clauses = filterEntries.map(([key], index) => `${safeIdentifier(key, "filter column")} is not distinct from $${index + 1}`);
			const values = filterEntries.map(([, value]) => value);
			const sql = `select ${columns} from ${schema}.${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} limit ${parsed.data.limit}`;
			const client = await pool.connect();
			try {
				await client.query("BEGIN READ ONLY");
				const result = await client.query(sql, values);
				await client.query("COMMIT");
				return { result: { rows: result.rows.slice(0, parsed.data.limit), rowCount: result.rowCount ?? result.rows.length } };
			} catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
		}
		if (action === "write_non_destructive") {
			if (!enabled("AIRA_SUPABASE_TOOL_ALLOW_WRITES") || /^prod(?:uction)?$/i.test(process.env.AIRA_SUPABASE_TOOL_ENVIRONMENT ?? "")) {
				throw new ToolGatewayError({ code: "SUPABASE_WRITE_DISABLED", message: "Supabase development writes are disabled for this environment.", status: 403 });
			}
			const parsed = SupabaseInsertSchema.safeParse(input);
			if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "Supabase insert input is invalid.", status: 400 });
			const entries = Object.entries(parsed.data.values);
			const columns = entries.map(([key]) => safeIdentifier(key, "column")).join(",");
			const placeholders = entries.map((_, index) => `$${index + 1}`).join(",");
			const sql = `insert into ${safeIdentifier(parsed.data.schema, "schema")}.${safeIdentifier(parsed.data.table, "table")} (${columns}) values (${placeholders}) returning *`;
			const result = await pool.query(sql, entries.map(([, value]) => value));
			return { result: { inserted: result.rows.slice(0, 1), rowCount: result.rowCount ?? 0 } };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Supabase action ${action} is not exposed. Arbitrary SQL, migrations and destructive operations are intentionally unavailable.`, status: 409 });
	},
};

// ---------------------------------------------------------------------------
// MCP bridge — intentionally explicit. This adapter talks only to a configured
// internal bridge and only to server-allowlisted tool names. MCP descriptions
// never become AIRA policy or authorization.
// ---------------------------------------------------------------------------
const McpCallSchema = z.object({ tool: z.string().trim().min(1).max(200), arguments: z.record(z.string(), z.unknown()).default({}) });
function mcpConfig(): { url: string; token: string; allowed: Set<string>; timeoutMs: number } {
	const raw = requiredEnv("AIRA_MCP_TOOL_BRIDGE_URL");
	const url = new URL(raw);
	const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (!["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash) {
		throw new ToolGatewayError({ code: "MCP_BRIDGE_CONFIG_INVALID", message: "MCP bridge URL is invalid or insecure.", status: 503 });
	}
	const allowed = new Set((process.env.AIRA_MCP_ALLOWED_TOOLS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
	const rawTimeout = Number(process.env.AIRA_MCP_TOOL_TIMEOUT_MS ?? "10000");
	const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(30_000, Math.max(500, Math.trunc(rawTimeout))) : 10_000;
	return { url: url.toString().replace(/\/$/, ""), token: requiredEnv("AIRA_MCP_TOOL_BRIDGE_TOKEN"), allowed, timeoutMs };
}

export const mcpToolAdapter: ToolAdapter = {
	id: "mcp",
	async isAvailable() {
		return enabled("AIRA_MCP_TOOL_ENABLED") && Boolean(process.env.AIRA_MCP_TOOL_BRIDGE_URL?.trim() && process.env.AIRA_MCP_TOOL_BRIDGE_TOKEN?.trim() && process.env.AIRA_MCP_ALLOWED_TOOLS?.trim());
	},
	async execute(_context, action, input) {
		if (action !== "call") throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: "MCP only exposes explicit allowlisted tool calls.", status: 409 });
		const parsed = McpCallSchema.safeParse(input);
		if (!parsed.success) throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message: "MCP call input is invalid.", status: 400 });
		const cfg = mcpConfig();
		if (!cfg.allowed.has(parsed.data.tool)) throw new ToolGatewayError({ code: "MCP_TOOL_NOT_ALLOWED", message: "This MCP tool is not server-allowlisted.", status: 403 });
		const argumentsJson = serializeMcpArguments(parsed.data.arguments);
		const body = `{"tool":${JSON.stringify(parsed.data.tool)},"arguments":${argumentsJson}}`;
		const value = await jsonFetch(`${cfg.url}/call`, {
			method: "POST",
			headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
			body,
		}, { timeoutMs: cfg.timeoutMs, maxResponseBytes: MCP_MAX_RESPONSE_BYTES, strictJson: true });
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new ToolGatewayError({ code: "MCP_RESPONSE_INVALID", message: "MCP bridge must return a JSON object.", status: 502 });
		}
		return { result: {
			data: safeObject(value),
			trust: UNTRUSTED_MCP_CONTENT,
			provenance: { provider: "mcp", tool: parsed.data.tool },
		} };
	},
};

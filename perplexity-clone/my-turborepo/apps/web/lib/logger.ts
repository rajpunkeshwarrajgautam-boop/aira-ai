import crypto from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ErrorCategory =
	| "4xx.CLIENT_INPUT"
	| "4xx.AUTH"
	| "4xx.RATE_LIMIT"
	| "5xx.INTERNAL"
	| "5xx.DATABASE"
	| "5xx.PROVIDER"
	| "5xx.STREAM"
	| "5xx.TOOL";

export interface LogEntry {
	readonly timestamp: string;
	readonly level: LogLevel;
	readonly message: string;
	readonly requestId?: string;
	readonly route?: string;
	readonly method?: string;
	readonly status?: number;
	readonly durationMs?: number;
	readonly authState?: "authenticated" | "guest";
	readonly category?: ErrorCategory;
	readonly provider?: string;
	readonly model?: string;
	readonly fallbackCount?: number;
	readonly retryCount?: number;
	readonly streaming?: boolean;
	readonly errorCode?: string;
	readonly metadata?: Record<string, unknown>;
}

const REDACTED_KEYS = new Set([
	"password",
	"secret",
	"token",
	"apikey",
	"api_key",
	"authorization",
	"cookie",
	"cookies",
	"database_url",
	"direct_url",
	"connectionstring",
	"service_role_key",
	"client_secret",
]);

const SECRET_REGEXES = [
	/sk-[A-Za-z0-9_-]{20,}/g,
	/nvapi-[A-Za-z0-9_-]{20,}/g,
	/postgres(ql)?:\/\/[^:]+:[^@]+@[^/]+/gi,
	/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

export function redactString(val: string): string {
	let sanitized = val;
	for (const regex of SECRET_REGEXES) {
		sanitized = sanitized.replace(regex, "[REDACTED_SECRET]");
	}
	return sanitized;
}

export function redactValue(key: string, value: unknown, depth = 0): unknown {
	if (depth > 6) return "[DEPTH_EXCEEDED]";
	if (value === null || value === undefined) return value;

	const lowerKey = key.toLowerCase();
	for (const redacted of REDACTED_KEYS) {
		if (lowerKey.includes(redacted)) {
			return "[REDACTED]";
		}
	}

	if (typeof value === "string") {
		// Truncate long user queries or prompts to prevent prompt/PII leakage
		if (lowerKey === "query" || lowerKey === "prompt") {
			if (value.length > 80) {
				return redactString(value.slice(0, 80)) + "... [TRUNCATED]";
			}
		}
		return redactString(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => redactValue(key, item, depth + 1));
	}

	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = redactValue(k, v, depth + 1);
		}
		return result;
	}

	return value;
}

class AiraLogger {
	private isProd = process.env.NODE_ENV === "production";

	private write(entry: LogEntry): void {
		const sanitized: LogEntry = {
			...entry,
			message: redactString(entry.message),
			metadata: entry.metadata
				? (redactValue("metadata", entry.metadata) as Record<string, unknown>)
				: undefined,
		};

		const formatted = JSON.stringify(sanitized);

		// Routing: Only true 5xx / fatal crashes go to stderr to prevent
		// normal client input errors (4xx) from polluting production error dashboards.
		if (entry.level === "error" && (!entry.status || entry.status >= 500)) {
			console.error(formatted);
		} else if (entry.level === "warn" || (entry.status && entry.status >= 400 && entry.status < 500)) {
			console.warn(formatted);
		} else {
			console.log(formatted);
		}
	}

	info(message: string, context: Partial<LogEntry> = {}): void {
		this.write({
			timestamp: new Date().toISOString(),
			level: "info",
			message,
			...context,
		});
	}

	warn(message: string, context: Partial<LogEntry> = {}): void {
		this.write({
			timestamp: new Date().toISOString(),
			level: "warn",
			message,
			...context,
		});
	}

	error(message: string, context: Partial<LogEntry> = {}): void {
		this.write({
			timestamp: new Date().toISOString(),
			level: "error",
			message,
			...context,
		});
	}

	clientError(message: string, context: Partial<LogEntry> = {}): void {
		this.write({
			timestamp: new Date().toISOString(),
			level: "warn",
			category: "4xx.CLIENT_INPUT",
			status: context.status ?? 400,
			message,
			...context,
		});
	}
}

export const logger = new AiraLogger();

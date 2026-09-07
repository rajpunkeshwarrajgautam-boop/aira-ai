import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ConnectorCredential } from "./types";

export interface StoredConnection {
	readonly connectionId: string;
	readonly userId: string;
	readonly connectorId: string;
	readonly encryptedData: string;
	readonly iv: string;
	readonly tag: string;
	readonly createdAt: string;
}

const MASTER_ENCRYPTION_KEY = createHash("sha256")
	.update(process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET || "aira-truthmode-fallback-secret-key-32b")
	.digest();

export class ConnectorCredentialStore {
	private connections = new Map<string, StoredConnection>();

	async registerConnectionAsync(
		userId: string,
		connectionId: string,
		connectorId: string,
		credential: ConnectorCredential,
	): Promise<void> {
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", MASTER_ENCRYPTION_KEY, iv);
		const json = JSON.stringify(credential);
		let encrypted = cipher.update(json, "utf8", "hex");
		encrypted += cipher.final("hex");
		const tag = cipher.getAuthTag().toString("hex");

		this.connections.set(`${userId}:${connectionId}`, {
			connectionId,
			userId,
			connectorId,
			encryptedData: encrypted,
			iv: iv.toString("hex"),
			tag,
			createdAt: new Date().toISOString(),
		});
	}

	async resolveCredentialAsync(
		userId: string,
		connectionId: string,
	): Promise<ConnectorCredential> {
		const stored = this.connections.get(`${userId}:${connectionId}`);
		if (!stored) {
			throw new Error(`Connector connection '${connectionId}' not found or unauthorized for user '${userId}'.`);
		}
		if (stored.userId !== userId) {
			throw new Error(`Unauthorized connection access: connection '${connectionId}' does not belong to user '${userId}'.`);
		}

		try {
			const decipher = createDecipheriv(
				"aes-256-gcm",
				MASTER_ENCRYPTION_KEY,
				Buffer.from(stored.iv, "hex"),
			);
			decipher.setAuthTag(Buffer.from(stored.tag, "hex"));
			let decrypted = decipher.update(stored.encryptedData, "hex", "utf8");
			decrypted += decipher.final("utf8");
			return JSON.parse(decrypted) as ConnectorCredential;
		} catch (err) {
			throw new Error(`Failed to decrypt credential for connection '${connectionId}': ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

export const globalConnectorCredentialStore = new ConnectorCredentialStore();

const SECRET_PATTERNS = [
	/ya29\.[a-zA-Z0-9_-]+/gi,
	/1\/\/[a-zA-Z0-9_-]+/gi,
	/sk-[a-zA-Z0-9_-]+/gi,
	/ghp_[a-zA-Z0-9_-]+/gi,
	/xox[baprs]-[a-zA-Z0-9_-]+/gi,
	/bearer\s+[a-zA-Z0-9._-]+/gi,
];

const SECRET_KEY_NAMES = new Set([
	"credential",
	"accesstoken",
	"access_token",
	"refreshtoken",
	"refresh_token",
	"apikey",
	"api_key",
	"clientsecret",
	"client_secret",
	"signingsecret",
	"signing_secret",
	"authorization",
	"password",
	"secret",
	"privatekey",
	"private_key",
	"cookie",
	"setcookie",
	"set_cookie",
	"token",
]);

export function redactSecrets<T>(val: T, depth = 0): T {
	if (depth > 10 || val === null || val === undefined) return val;
	if (typeof val === "string") {
		let sanitized: string = val;
		sanitized = sanitized.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, "$1[REDACTED_DB_PASS]$3");
		for (const pattern of SECRET_PATTERNS) {
			sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
		}
		return sanitized as unknown as T;
	}
	if (Array.isArray(val)) {
		return val.map((x) => redactSecrets(x, depth + 1)) as unknown as T;
	}
	if (typeof val === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
			const normalized = k.toLowerCase().replace(/[-_]/g, "");
			if (SECRET_KEY_NAMES.has(normalized)) {
				out[k] = "[REDACTED]";
			} else if (k.toLowerCase() === "headers" && typeof v === "object" && v !== null) {
				out[k] = "[REDACTED_HEADERS]";
			} else {
				out[k] = redactSecrets(v, depth + 1);
			}
		}
		return out as unknown as T;
	}
	return val;
}

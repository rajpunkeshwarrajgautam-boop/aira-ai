import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
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

type DbStoredConnection = {
	id: string;
	userId: string;
	connectorId: string;
	encryptedData: string;
	iv: string;
	tag: string;
	createdAt: Date;
};

let localEphemeralKey: Buffer | undefined;

function getMasterEncryptionKey(): Buffer {
	const configured = process.env.ENCRYPTION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
	if (configured) {
		return createHash("sha256").update(configured).digest();
	}

	// Database-backed/server deployments must never encrypt credentials with a
	// predictable fallback. Local-only mode may use a process-ephemeral key
	// because its connection store is intentionally memory-only.
	if (process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
		throw new Error(
			"Connector credential encryption is not configured. Set ENCRYPTION_SECRET or NEXTAUTH_SECRET on the server.",
		);
	}

	localEphemeralKey ??= randomBytes(32);
	return localEphemeralKey;
}

function encryptCredential(credential: ConnectorCredential): Pick<StoredConnection, "encryptedData" | "iv" | "tag"> {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", getMasterEncryptionKey(), iv);
	const json = JSON.stringify(credential);
	let encrypted = cipher.update(json, "utf8", "hex");
	encrypted += cipher.final("hex");
	return {
		encryptedData: encrypted,
		iv: iv.toString("hex"),
		tag: cipher.getAuthTag().toString("hex"),
	};
}

function decryptCredential(stored: StoredConnection): ConnectorCredential {
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			getMasterEncryptionKey(),
			Buffer.from(stored.iv, "hex"),
		);
		decipher.setAuthTag(Buffer.from(stored.tag, "hex"));
		let decrypted = decipher.update(stored.encryptedData, "hex", "utf8");
		decrypted += decipher.final("utf8");
		return JSON.parse(decrypted) as ConnectorCredential;
	} catch (err) {
		throw new Error(
			`Failed to decrypt credential for connection '${stored.connectionId}': ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export class ConnectorCredentialStore {
	private connections = new Map<string, StoredConnection>();

	async registerConnectionAsync(
		userId: string,
		connectionId: string,
		connectorId: string,
		credential: ConnectorCredential,
	): Promise<void> {
		if (!userId.trim() || !connectionId.trim() || !connectorId.trim()) {
			throw new Error("userId, connectionId, and connectorId are required.");
		}
		const encrypted = encryptCredential(credential);
		const createdAt = new Date();

		if (process.env.DATABASE_URL) {
			const affected = await prisma.$executeRaw`
				INSERT INTO "ConnectorConnection" (
					"id", "userId", "connectorId", "encryptedData", "iv", "tag", "createdAt", "updatedAt"
				) VALUES (
					${connectionId}, ${userId}, ${connectorId}, ${encrypted.encryptedData}, ${encrypted.iv}, ${encrypted.tag}, ${createdAt}, ${createdAt}
				)
				ON CONFLICT ("id") DO UPDATE SET
					"connectorId" = EXCLUDED."connectorId",
					"encryptedData" = EXCLUDED."encryptedData",
					"iv" = EXCLUDED."iv",
					"tag" = EXCLUDED."tag",
					"updatedAt" = EXCLUDED."updatedAt"
				WHERE "ConnectorConnection"."userId" = EXCLUDED."userId"
			`;
			if (affected !== 1) {
				throw new Error(`Connector connection '${connectionId}' already belongs to another user.`);
			}
			return;
		}

		this.connections.set(`${userId}:${connectionId}`, {
			connectionId,
			userId,
			connectorId,
			...encrypted,
			createdAt: createdAt.toISOString(),
		});
	}

	async resolveCredentialAsync(userId: string, connectionId: string): Promise<ConnectorCredential> {
		let stored: StoredConnection | undefined;

		if (process.env.DATABASE_URL) {
			const rows = await prisma.$queryRaw<DbStoredConnection[]>`
				SELECT "id", "userId", "connectorId", "encryptedData", "iv", "tag", "createdAt"
				FROM "ConnectorConnection"
				WHERE "id" = ${connectionId} AND "userId" = ${userId}
				LIMIT 1
			`;
			const row = rows[0];
			if (row) {
				stored = {
					connectionId: row.id,
					userId: row.userId,
					connectorId: row.connectorId,
					encryptedData: row.encryptedData,
					iv: row.iv,
					tag: row.tag,
					createdAt: row.createdAt.toISOString(),
				};
			}
		} else {
			stored = this.connections.get(`${userId}:${connectionId}`);
		}

		if (!stored || stored.userId !== userId) {
			throw new Error(`Connector connection '${connectionId}' not found or unauthorized.`);
		}
		return decryptCredential(stored);
	}

	async revokeConnectionAsync(userId: string, connectionId: string): Promise<boolean> {
		if (process.env.DATABASE_URL) {
			const affected = await prisma.$executeRaw`
				DELETE FROM "ConnectorConnection"
				WHERE "id" = ${connectionId} AND "userId" = ${userId}
			`;
			return affected === 1;
		}
		return this.connections.delete(`${userId}:${connectionId}`);
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

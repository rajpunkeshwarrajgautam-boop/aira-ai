import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

export interface BlobMetadata {
	readonly storageUri: string;
	readonly sizeBytes: number;
	readonly checksum: string;
	readonly mimeType: string;
}

export interface BlobStorageProvider {
	putBlob(key: string, data: Buffer, mimeType: string): Promise<BlobMetadata>;
	getBlob(storageUri: string): Promise<Buffer>;
	deleteBlob(storageUri: string): Promise<boolean>;
}

export class PostgresBlobStorageProvider implements BlobStorageProvider {
	private readonly maxSizeBytes: number;

	constructor(maxSizeBytes = 10 * 1024 * 1024) {
		this.maxSizeBytes = maxSizeBytes;
	}

	async putBlob(key: string, data: Buffer, mimeType: string): Promise<BlobMetadata> {
		if (data.length > this.maxSizeBytes) {
			throw new Error(`Artifact size ${data.length} exceeds Postgres durable storage limit of ${this.maxSizeBytes} bytes`);
		}
		const checksum = createHash("sha256").update(data).digest("hex");
		const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_");

		await prisma.durableBlob.upsert({
			where: { key: safeKey },
			create: {
				key: safeKey,
				data: new Uint8Array(data),
				mimeType,
				sizeBytes: data.length,
				checksum,
			},
			update: {
				data: new Uint8Array(data),
				mimeType,
				sizeBytes: data.length,
				checksum,
			},
		});

		return {
			storageUri: `pgblob://${safeKey}`,
			sizeBytes: data.length,
			checksum,
			mimeType,
		};
	}

	async getBlob(storageUri: string): Promise<Buffer> {
		if (!storageUri.startsWith("pgblob://")) {
			throw new Error(`Unsupported storageUri scheme for PostgresBlobStorageProvider: ${storageUri}`);
		}
		const key = storageUri.replace("pgblob://", "");
		const record = await prisma.durableBlob.findUnique({
			where: { key },
		});
		if (!record) {
			throw new Error(`Durable blob not found in PostgreSQL: ${storageUri}`);
		}
		return Buffer.from(record.data);
	}

	async deleteBlob(storageUri: string): Promise<boolean> {
		if (!storageUri.startsWith("pgblob://")) return false;
		const key = storageUri.replace("pgblob://", "");
		try {
			await prisma.durableBlob.delete({ where: { key } });
			return true;
		} catch {
			return false;
		}
	}
}

export class LocalBlobStorageProvider implements BlobStorageProvider {
	private readonly blobDir: string;

	constructor(blobDir?: string) {
		this.blobDir = blobDir ?? process.env.AIRA_BLOB_DIR ?? join(process.cwd(), ".aira-blobs");
		if (!existsSync(this.blobDir)) {
			try {
				mkdirSync(this.blobDir, { recursive: true });
			} catch {
				// ignore
			}
		}
	}

	async putBlob(key: string, data: Buffer, mimeType: string): Promise<BlobMetadata> {
		if (!existsSync(this.blobDir)) {
			mkdirSync(this.blobDir, { recursive: true });
		}
		const checksum = createHash("sha256").update(data).digest("hex");
		const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
		const filePath = join(this.blobDir, `${safeKey}.${checksum.slice(0, 12)}`);
		writeFileSync(filePath, data);

		return {
			storageUri: `file://${filePath.replace(/\\/g, "/")}`,
			sizeBytes: data.length,
			checksum,
			mimeType,
		};
	}

	async getBlob(storageUri: string): Promise<Buffer> {
		if (storageUri.startsWith("file://")) {
			const path = storageUri.replace("file://", "");
			if (!existsSync(path)) {
				throw new Error(`Blob not found at ${storageUri}`);
			}
			return readFileSync(path);
		}
		throw new Error(`Unsupported storageUri scheme: ${storageUri}`);
	}

	async deleteBlob(storageUri: string): Promise<boolean> {
		if (storageUri.startsWith("file://")) {
			const path = storageUri.replace("file://", "");
			if (existsSync(path)) {
				unlinkSync(path);
				return true;
			}
		}
		return false;
	}
}

export class DelegatingBlobStorageProvider implements BlobStorageProvider {
	private postgresProvider = new PostgresBlobStorageProvider();
	private localProvider = new LocalBlobStorageProvider();

	private isServerMode(): boolean {
		return Boolean(process.env.DATABASE_URL && process.env.AIRA_LOCAL_STORAGE_MODE !== "true");
	}

	async putBlob(key: string, data: Buffer, mimeType: string): Promise<BlobMetadata> {
		if (this.isServerMode()) {
			return this.postgresProvider.putBlob(key, data, mimeType);
		}
		return this.localProvider.putBlob(key, data, mimeType);
	}

	async getBlob(storageUri: string): Promise<Buffer> {
		if (storageUri.startsWith("pgblob://")) {
			return this.postgresProvider.getBlob(storageUri);
		}
		if (storageUri.startsWith("file://")) {
			if (this.isServerMode()) {
				throw new Error("file:// storage URIs are forbidden in production/server mode. Durable blob storage required.");
			}
			return this.localProvider.getBlob(storageUri);
		}
		throw new Error(`Unsupported storageUri scheme: ${storageUri}`);
	}

	async deleteBlob(storageUri: string): Promise<boolean> {
		if (storageUri.startsWith("pgblob://")) {
			return this.postgresProvider.deleteBlob(storageUri);
		}
		if (storageUri.startsWith("file://")) {
			if (this.isServerMode()) return false;
			return this.localProvider.deleteBlob(storageUri);
		}
		return false;
	}
}

export const globalBlobStorage: BlobStorageProvider = new DelegatingBlobStorageProvider();

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export const globalBlobStorage: BlobStorageProvider = new LocalBlobStorageProvider();

import { createHash } from "node:crypto";

export type DataEntityType =
	| "CONVERSATION"
	| "MESSAGE"
	| "USER_MEMORY"
	| "AGENT_RUN"
	| "ARTIFACT"
	| "KNOWLEDGE_DOCUMENT"
	| "CONNECTOR_TOKEN"
	| "USER_ACCOUNT_FULL_PURGE"
	| string;

export interface DataRetentionPolicy {
	readonly entityType: DataEntityType;
	readonly retentionDays: number;
	readonly autoHardDelete: boolean;
}

export interface DeletionAuditReceipt {
	readonly receiptId: string;
	readonly userId: string;
	readonly entityType: DataEntityType;
	readonly entityId: string;
	readonly deletedAt: string;
	readonly method: "SOFT_DELETE" | "HARD_PURGE";
	readonly verificationHash: string;
}

export class DataLifecycleManager {
	private receipts: DeletionAuditReceipt[] = [];

	recordDeletion(receipt: DeletionAuditReceipt): void {
		this.receipts.push(receipt);
	}

	generateDeletionReceipt(userId: string, entityType: DataEntityType, count: number): DeletionAuditReceipt {
		const id = `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		const verificationHash = createHash("sha256").update(`${id}:${userId}:${entityType}:${count}:${now}`).digest("hex");
		const receipt: DeletionAuditReceipt = {
			receiptId: id,
			userId,
			entityType,
			entityId: `batch_${count}_records`,
			deletedAt: now,
			method: "HARD_PURGE",
			verificationHash,
		};
		this.recordDeletion(receipt);
		return receipt;
	}

	getReceipts(userId: string): readonly DeletionAuditReceipt[] {
		return this.receipts.filter((r) => r.userId === userId);
	}
}

export const globalDataLifecycleManager = new DataLifecycleManager();

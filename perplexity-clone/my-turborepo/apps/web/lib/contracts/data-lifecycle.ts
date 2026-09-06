export type DataEntityType =
	| "CONVERSATION"
	| "MESSAGE"
	| "USER_MEMORY"
	| "AGENT_RUN"
	| "ARTIFACT"
	| "KNOWLEDGE_DOCUMENT"
	| "CONNECTOR_TOKEN";

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

	getReceipts(userId: string): readonly DeletionAuditReceipt[] {
		return this.receipts.filter((r) => r.userId === userId);
	}
}

export const globalDataLifecycleManager = new DataLifecycleManager();

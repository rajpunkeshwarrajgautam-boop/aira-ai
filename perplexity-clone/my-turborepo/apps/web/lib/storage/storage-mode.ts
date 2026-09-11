export type RuntimeStorageMode = "DATABASE_CANONICAL" | "LOCAL";

export function getRuntimeStorageMode(): RuntimeStorageMode {
	if (process.env.AIRA_LOCAL_STORAGE_MODE === "true") {
		return "LOCAL";
	}
	if (process.env.DATABASE_URL) {
		return "DATABASE_CANONICAL";
	}
	return "LOCAL";
}

export function isDatabaseCanonical(): boolean {
	return getRuntimeStorageMode() === "DATABASE_CANONICAL";
}

export function isLocalStorageMode(): boolean {
	return getRuntimeStorageMode() === "LOCAL";
}

export function isServerStorageMode(): boolean {
	return Boolean(process.env.DATABASE_URL && process.env.AIRA_LOCAL_STORAGE_MODE !== "true");
}

export function assertServerStorageSafety(context = "server"): void {
	if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL && process.env.AIRA_LOCAL_STORAGE_MODE !== "true") {
		throw new Error(
			`Ambiguous storage mode in ${context}: Production environment requires DATABASE_URL for DATABASE_CANONICAL mode, or explicit AIRA_LOCAL_STORAGE_MODE=true for offline test mode.`,
		);
	}
}

export function assertServerAsyncExecution(caller: string): void {
	assertServerStorageSafety(caller);
	if (isDatabaseCanonical()) {
		// In database-canonical mode, synchronous store methods must not be called from server execution paths
		return;
	}
}

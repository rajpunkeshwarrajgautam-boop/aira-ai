export interface ConversationGroupingItem {
	readonly id: string;
	readonly lastMessageAt: string | Date;
	readonly pinnedAt?: string | Date | null;
}

export type RecentDateGroupKey = "today" | "yesterday" | "previous-7-days" | "older";

export interface ConversationDateGroup<T extends ConversationGroupingItem = ConversationGroupingItem> {
	readonly key: RecentDateGroupKey;
	readonly label: "Today" | "Yesterday" | "Previous 7 Days" | "Older";
	readonly items: readonly T[];
}

export interface PartitionedConversations<T extends ConversationGroupingItem = ConversationGroupingItem> {
	readonly pinned: readonly T[];
	readonly recentGroups: readonly ConversationDateGroup<T>[];
}

const GROUP_LABELS: Record<RecentDateGroupKey, ConversationDateGroup["label"]> = {
	today: "Today",
	yesterday: "Yesterday",
	"previous-7-days": "Previous 7 Days",
	older: "Older",
};

function compareId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function dateMs(value: string | Date, fieldName: string): number {
	const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
	if (!Number.isFinite(time)) {
		throw new TypeError(`Invalid ${fieldName} timestamp.`);
	}
	return time;
}

function normalizedReferenceDate(referenceDate?: Date | number): Date {
	const ref =
		referenceDate instanceof Date
			? new Date(referenceDate.getTime())
			: typeof referenceDate === "number"
				? new Date(referenceDate)
				: new Date();

	if (!Number.isFinite(ref.getTime())) {
		throw new RangeError("Invalid referenceDate.");
	}

	return ref;
}

export function partitionConversations<T extends ConversationGroupingItem>(
	conversations: readonly T[],
	referenceDate?: Date | number,
): PartitionedConversations<T> {
	const refDate = normalizedReferenceDate(referenceDate);

	const startOfToday = new Date(
		refDate.getFullYear(),
		refDate.getMonth(),
		refDate.getDate(),
		0,
		0,
		0,
		0,
	).getTime();
	const startOfYesterday = new Date(
		refDate.getFullYear(),
		refDate.getMonth(),
		refDate.getDate() - 1,
		0,
		0,
		0,
		0,
	).getTime();
	const startOf7DaysAgo = new Date(
		refDate.getFullYear(),
		refDate.getMonth(),
		refDate.getDate() - 7,
		0,
		0,
		0,
		0,
	).getTime();

	const pinned: T[] = [];
	const recent: T[] = [];

	for (const item of conversations) {
		if (item.pinnedAt !== null && item.pinnedAt !== undefined) {
			dateMs(item.pinnedAt, "pinnedAt");
			pinned.push(item);
		} else {
			recent.push(item);
		}
	}

	pinned.sort((a, b) => {
		const timeA = dateMs(a.pinnedAt as string | Date, "pinnedAt");
		const timeB = dateMs(b.pinnedAt as string | Date, "pinnedAt");
		if (timeB !== timeA) return timeB - timeA;
		return compareId(a.id, b.id);
	});

	recent.sort((a, b) => {
		const timeA = dateMs(a.lastMessageAt, "lastMessageAt");
		const timeB = dateMs(b.lastMessageAt, "lastMessageAt");
		if (timeB !== timeA) return timeB - timeA;
		return compareId(a.id, b.id);
	});

	const today: T[] = [];
	const yesterday: T[] = [];
	const previous7Days: T[] = [];
	const older: T[] = [];

	for (const item of recent) {
		const time = dateMs(item.lastMessageAt, "lastMessageAt");
		if (time >= startOfToday) {
			today.push(item);
		} else if (time >= startOfYesterday) {
			yesterday.push(item);
		} else if (time >= startOf7DaysAgo) {
			previous7Days.push(item);
		} else {
			older.push(item);
		}
	}

	const recentGroups: ConversationDateGroup<T>[] = [];
	if (today.length > 0) recentGroups.push({ key: "today", label: GROUP_LABELS.today, items: today });
	if (yesterday.length > 0) recentGroups.push({ key: "yesterday", label: GROUP_LABELS.yesterday, items: yesterday });
	if (previous7Days.length > 0) {
		recentGroups.push({
			key: "previous-7-days",
			label: GROUP_LABELS["previous-7-days"],
			items: previous7Days,
		});
	}
	if (older.length > 0) recentGroups.push({ key: "older", label: GROUP_LABELS.older, items: older });

	return { pinned, recentGroups };
}

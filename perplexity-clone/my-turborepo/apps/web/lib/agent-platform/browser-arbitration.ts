import { prisma } from "@/lib/prisma";

export type BrowserControlCommand = "human" | "agent" | "pause" | "resume";
export type BrowserActionSource = "AGENT" | "USER";

export function browserControlTransitionAllowed(status: string, control: BrowserControlCommand): boolean {
	if (control === "human") return status === "ACTIVE";
	if (control === "agent") return status === "HUMAN_CONTROL";
	if (control === "pause") return status === "ACTIVE" || status === "HUMAN_CONTROL";
	return status === "PAUSED";
}

export function browserControlTarget(control: BrowserControlCommand): "ACTIVE" | "HUMAN_CONTROL" | "PAUSED" {
	if (control === "human") return "HUMAN_CONTROL";
	if (control === "pause") return "PAUSED";
	return "ACTIVE";
}

export async function claimBrowserActionLease(input: {
	readonly userId: string;
	readonly sessionId: string;
	readonly source: BrowserActionSource;
	readonly leaseOwner: string;
	readonly leaseSeconds?: number;
}): Promise<boolean> {
	const leaseSeconds = Math.max(5, Math.min(30, Math.trunc(input.leaseSeconds ?? 20)));
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		update "BrowserSession"
		set "actionLeaseOwner"=${input.leaseOwner},
			"actionLeaseExpiresAt"=current_timestamp + (${leaseSeconds} * interval '1 second'),
			"updatedAt"=current_timestamp
		where "id"=${input.sessionId}
		  and "userId"=${input.userId}
		  and "expiresAt" > current_timestamp
		  and (
			(${input.source}='AGENT' and "status"='ACTIVE')
			or (${input.source}='USER' and "status"='HUMAN_CONTROL')
		  )
		  and ("actionLeaseOwner" is null or "actionLeaseExpiresAt" < current_timestamp)
		returning "id"
	`;
	return Boolean(rows[0]);
}

export async function releaseBrowserActionLease(input: {
	readonly userId: string;
	readonly sessionId: string;
	readonly leaseOwner: string;
}): Promise<void> {
	await prisma.$executeRaw`
		update "BrowserSession"
		set "actionLeaseOwner"=null, "actionLeaseExpiresAt"=null, "updatedAt"=current_timestamp
		where "id"=${input.sessionId}
		  and "userId"=${input.userId}
		  and "actionLeaseOwner"=${input.leaseOwner}
	`;
}

export async function transitionBrowserControl(input: {
	readonly userId: string;
	readonly sessionId: string;
	readonly control: BrowserControlCommand;
}): Promise<{ readonly previousStatus: string; readonly status: string } | null> {
	const target = browserControlTarget(input.control);
	const allowed = input.control === "human"
		? ["ACTIVE"]
		: input.control === "agent"
			? ["HUMAN_CONTROL"]
			: input.control === "pause"
				? ["ACTIVE", "HUMAN_CONTROL"]
				: ["PAUSED"];
	const rows = await prisma.$queryRaw<Array<{ previousStatus: string; status: string }>>`
		with candidate as (
			select "id", "status" as "previousStatus"
			from "BrowserSession"
			where "id"=${input.sessionId}
			  and "userId"=${input.userId}
			  and "status" = any(${allowed}::text[])
			  and "expiresAt" > current_timestamp
			  and ("actionLeaseOwner" is null or "actionLeaseExpiresAt" < current_timestamp)
			for update
		), updated as (
			update "BrowserSession" s
			set "status"=${target}, "updatedAt"=current_timestamp
			from candidate c
			where s."id"=c."id"
			returning c."previousStatus", s."status"
		)
		select * from updated
	`;
	return rows[0] ?? null;
}

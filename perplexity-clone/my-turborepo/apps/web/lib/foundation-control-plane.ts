interface ControlPlaneResponse<T> {
	readonly ok: boolean;
	readonly data?: T;
	readonly error?: string;
}

export interface AdmissionLease {
	readonly allowed: boolean;
	readonly leaseId?: string;
	readonly retryAfterMs?: number;
	readonly degraded?: boolean;
}

function controlPlaneEnabled(): boolean {
	return process.env.FOUNDATION_CONTROL_PLANE_ENABLED === "true";
}

function controlPlaneRequired(): boolean {
	return process.env.FOUNDATION_CONTROL_PLANE_REQUIRED === "true";
}

function config(): { baseUrl: string; token: string } | null {
	const baseUrl = process.env.AIRA_CONTROL_PLANE_URL?.trim().replace(/\/$/, "");
	const token = process.env.AIRA_CONTROL_PLANE_TOKEN?.trim();
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const cfg = config();
	if (!cfg) throw new Error("Foundation control plane is not configured.");
	const timeoutMs = Number.parseInt(process.env.AIRA_CONTROL_PLANE_TIMEOUT_MS ?? "1500", 10);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 1500);
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json");
	headers.set("X-AIRA-Control-Token", cfg.token);
	try {
		const response = await fetch(`${cfg.baseUrl}${path}`, {
			...init,
			headers,
			signal: controller.signal,
			cache: "no-store",
		});
		const payload = (await response.json()) as ControlPlaneResponse<T>;
		if (!response.ok || !payload.ok || payload.data === undefined) {
			throw new Error(payload.error || `Control plane returned HTTP ${response.status}.`);
		}
		return payload.data;
	} finally {
		clearTimeout(timer);
	}
}

export async function admitFoundationRequest(args: {
	readonly requestId: string;
	readonly kind: "search" | "deep-research" | "agent";
}): Promise<AdmissionLease> {
	if (!controlPlaneEnabled()) return { allowed: true };
	try {
		return await request<AdmissionLease>("/v1/admit", {
			method: "POST",
			body: JSON.stringify(args),
		});
	} catch (error) {
		if (controlPlaneRequired()) throw error;
		console.warn(
			"[AIRA control plane] Admission check unavailable; continuing in degraded local mode:",
			error instanceof Error ? error.message : String(error),
		);
		return { allowed: true, degraded: true };
	}
}

export async function releaseFoundationLease(leaseId?: string): Promise<void> {
	if (!controlPlaneEnabled() || !leaseId) return;
	try {
		await request<{ released: boolean }>("/v1/release", {
			method: "POST",
			body: JSON.stringify({ leaseId }),
		});
	} catch (error) {
		console.warn(
			"[AIRA control plane] Lease release failed:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export async function globalProviderAllowed(providerId: string): Promise<boolean | null> {
	if (!controlPlaneEnabled()) return null;
	try {
		const data = await request<{ allowed: boolean }>(`/v1/providers/${encodeURIComponent(providerId)}/allowed`);
		return data.allowed;
	} catch (error) {
		if (controlPlaneRequired()) throw error;
		return null;
	}
}

export async function recordGlobalProviderOutcome(args: {
	readonly providerId: string;
	readonly outcome: "success" | "failure";
	readonly failureClass?: string;
}): Promise<void> {
	if (!controlPlaneEnabled()) return;
	try {
		await request<{ recorded: boolean }>(`/v1/providers/${encodeURIComponent(args.providerId)}/outcome`, {
			method: "POST",
			body: JSON.stringify({ outcome: args.outcome, failureClass: args.failureClass ?? null }),
		});
	} catch (error) {
		if (controlPlaneRequired()) throw error;
	}
}

export async function enqueueFoundationJob(args: {
	readonly type: string;
	readonly payload: Record<string, unknown>;
	readonly attempts?: number;
}): Promise<string> {
	const data = await request<{ jobId: string }>("/v1/jobs/enqueue", {
		method: "POST",
		body: JSON.stringify({
			type: args.type,
			payload: args.payload,
			attempts: args.attempts ?? 0,
		}),
	});
	return data.jobId;
}

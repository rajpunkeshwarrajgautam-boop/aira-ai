import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const MCP_TIMEOUT_MS = 8_000;

function advancedReasoningContextText(): string {
	return [
		"ADVANCED REASONING MODE (high-level reasoning only):",
		"- Frame the decision criteria, constraints, and unknowns before committing to an answer.",
		"- Consider at least two materially different hypotheses or approaches when the problem admits alternatives.",
		"- Identify evidence that would support or falsify each hypothesis; revise when evidence conflicts.",
		"- Separate verified facts, assumptions, and inference; calibrate confidence to the evidence.",
		"- For architecture/debugging work, test likely bottlenecks and failure modes rather than assuming one cause.",
		"- Present conclusions, evidence, concise rationale, and uncertainty. Never reveal or store private chain-of-thought.",
	].join("\n");
}

function remoteConfig(): { endpoint: string; token?: string } | null {
	if (process.env.AIRA_ADVANCED_REASONING_MCP_ENABLED !== "true") return null;
	if (process.env.AIRA_ADVANCED_REASONING_MCP_TENANT_SAFE !== "true") return null;
	const raw = process.env.AIRA_ADVANCED_REASONING_MCP_URL?.trim();
	if (!raw) return null;
	let endpoint: URL;
	try {
		endpoint = new URL(raw);
	} catch {
		return null;
	}
	if (endpoint.protocol !== "https:" && !(process.env.NODE_ENV === "development" && endpoint.hostname === "localhost")) {
		return null;
	}
	const token = process.env.AIRA_ADVANCED_REASONING_MCP_BEARER_TOKEN?.trim();
	return { endpoint: endpoint.toString(), ...(token ? { token } : {}) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = MCP_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise.finally(() => {
			if (timer) clearTimeout(timer);
		}),
		new Promise<T>((_, reject) => {
			timer = setTimeout(() => reject(new Error("Advanced Reasoning MCP operation timed out.")), timeoutMs);
		}),
	]);
}

function authenticatedFetch(token?: string) {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const headers = new Headers(init?.headers);
		if (token) headers.set("Authorization", `Bearer ${token}`);
		return globalThis.fetch(input, { ...init, headers });
	};
}

async function recordReasoningProtocol(query: string): Promise<boolean> {
	const config = remoteConfig();
	if (!config) return false;
	const client = new Client(
		{ name: "aira-ai", version: "1.0.0" },
		{ listMaxPages: 2, versionNegotiation: { mode: "auto" } },
	);
	const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
		fetch: authenticatedFetch(config.token),
	});
	const phases = [
		"Frame decision criteria, constraints, and unknowns for this request.",
		"Form competing hypotheses or approaches and identify discriminating evidence.",
		"Plan verification, revision, and confidence calibration before synthesis.",
	] as const;
	try {
		await withTimeout(client.connect(transport));
		for (let index = 0; index < phases.length; index += 1) {
			const result = await withTimeout(
				client.callTool({
					name: "advanced_reasoning",
					arguments: {
						thought: phases[index],
						thoughtNumber: index + 1,
						totalThoughts: phases.length,
						nextThoughtNeeded: index < phases.length - 1,
						confidence: index === phases.length - 1 ? 0.7 : 0.5,
						reasoning_quality: "high",
						goal: query.slice(0, 2_000),
					},
				}),
			);
			if (result.isError) throw new Error("Advanced Reasoning MCP returned an error result.");
		}
		return true;
	} catch (error) {
		console.warn("[AiraAdvancedReasoning] MCP unavailable; using embedded reasoning contract", {
			code: error instanceof Error ? error.name : "ADVANCED_REASONING_MCP_FAILED",
		});
		return false;
	} finally {
		try {
			await withTimeout(client.close(), 2_000);
		} catch {
			// Best effort.
		}
	}
}

/**
 * Command-aware integration of the methodology exposed by angrysky56/advanced-reasoning-mcp.
 *
 * The upstream server is stdio-first. AIRA can optionally call a tenant-isolated HTTP MCP
 * deployment when configured; otherwise the same high-level hypothesis/evidence/verification
 * contract is applied natively. We intentionally do not request, expose, or persist private
 * chain-of-thought.
 */
export async function buildAdvancedReasoningContext(query: string): Promise<{
	readonly context: string;
	readonly provider: "ADVANCED_REASONING_MCP" | "AIRA_EMBEDDED";
}> {
	const usedMcp = await recordReasoningProtocol(query);
	return {
		context: advancedReasoningContextText(),
		provider: usedMcp ? "ADVANCED_REASONING_MCP" : "AIRA_EMBEDDED",
	};
}

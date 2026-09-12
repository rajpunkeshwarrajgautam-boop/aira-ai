import assert from "node:assert/strict";
import { test } from "node:test";

import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tool-gateway/gateway";
import { webToolAdapter } from "@/lib/tool-gateway/native-adapters";
import { POST as StandaloneRuntimePOST } from "../app/api/internal/tool-gateway/standalone-runtime/route";

test("Standalone Runtime Tool Gateway Bridge - Auth & Validation Gates", async () => {
	const originalToken = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN;
	const originalEnabled = process.env.AIRA_TOOL_GATEWAY_ENABLED;
	process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = "test_valid_runtime_token_32chars_long!";
	process.env.AIRA_TOOL_GATEWAY_ENABLED = "true";

	try {
		// 1. Missing Authorization Header -> 401
		const reqNoAuth = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				runId: "run_test_001",
				clientRequestId: "req_test_001",
				tool: "web",
				action: "search",
				input: { query: "Next.js" },
			}),
		});
		const resNoAuth = await StandaloneRuntimePOST(reqNoAuth);
		assert.equal(resNoAuth.status, 401, "Missing auth token must return HTTP 401");

		// 2. Invalid Token -> 401
		const reqBadAuth = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong_token_value_32chars_long!!",
			},
			body: JSON.stringify({
				runId: "run_test_001",
				clientRequestId: "req_test_001",
				tool: "web",
				action: "search",
				input: { query: "Next.js" },
			}),
		});
		const resBadAuth = await StandaloneRuntimePOST(reqBadAuth);
		assert.equal(resBadAuth.status, 401, "Invalid auth token must return HTTP 401");

		// 3. Valid Token but invalid body -> 400
		const reqBadBody = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN}`,
			},
			body: JSON.stringify({ runId: "short" }),
		});
		const resBadBody = await StandaloneRuntimePOST(reqBadBody);
		assert.equal(resBadBody.status, 400, "Invalid request body must return HTTP 400");
	} finally {
		process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = originalToken;
		process.env.AIRA_TOOL_GATEWAY_ENABLED = originalEnabled;
	}
});

test("Standalone Runtime Tool Gateway Bridge - Server-Authoritative Policy Matrix", async () => {
	const originalToken = process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN;
	const originalEnabled = process.env.AIRA_TOOL_GATEWAY_ENABLED;
	const originalExaKey = process.env.EXA_API_KEY;
	process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = "test_valid_runtime_token_32chars_long!";
	process.env.AIRA_TOOL_GATEWAY_ENABLED = "true";
	process.env.EXA_API_KEY = "test_exa_api_key_for_unit_tests";

	const originalWebExecute = webToolAdapter.execute;
	webToolAdapter.execute = async () => ({
		result: {
			title: "Next.js Documentation",
			url: "https://nextjs.org/docs",
			excerpt: "Next.js Documentation Home Page",
		},
	});

	const userA = "usr_standalone_alpha_100";
	const userB = "usr_standalone_beta_200";

	// Create AgentDefinition for User A with tools = ["web"]
	const agentAWebOnly = globalUserAgentStore.createAgent(userA, {
		name: "Web Only Agent",
		description: "Allowed web search only",
		instructions: "Perform web search",
		modelPolicy: { provider: "AUTO", temperature: 0.2, maxTokens: 8192 },
		tools: ["web"],
		skills: [],
		connectors: [],
		memoryPolicy: { enabled: true, scope: "GLOBAL" },
		budget: { maxCostUsd: 100, maxDurationMinutes: 180 },
		riskPolicy: { requireApprovalAbove: "PROTECTED" },
		isPublic: false,
	});

	// Create AgentDefinition for User A with tools = []
	const agentANoTools = globalUserAgentStore.createAgent(userA, {
		name: "No Tools Agent",
		description: "Allowed no tools",
		instructions: "Do not use tools",
		modelPolicy: { provider: "AUTO", temperature: 0.2, maxTokens: 8192 },
		tools: [],
		skills: [],
		connectors: [],
		memoryPolicy: { enabled: true, scope: "GLOBAL" },
		budget: { maxCostUsd: 100, maxDurationMinutes: 180 },
		riskPolicy: { requireApprovalAbove: "PROTECTED" },
		isPublic: false,
	});

	try {
		const mockAgentRun = {
			findFirst: (async (args: { where: { id?: string; userId?: string } }) => {
				if (args.where.id === "run_userA_web" && args.where.userId === userA) {
					return { graphId: `agent-def:${agentAWebOnly.id}`, userId: userA };
				}
				if (args.where.id === "run_userA_empty" && args.where.userId === userA) {
					return { graphId: `agent-def:${agentANoTools.id}`, userId: userA };
				}
				return null;
			}) as unknown,
			findUnique: (async (args: { where: { id: string } }) => {
				if (args.where.id === "run_userA_web") {
					return {
						id: "run_userA_web",
						userId: userA,
						graphId: `agent-def:${agentAWebOnly.id}`,
						status: "RUNNING",
					};
				}
				if (args.where.id === "run_userA_empty") {
					return {
						id: "run_userA_empty",
						userId: userA,
						graphId: `agent-def:${agentANoTools.id}`,
						status: "RUNNING",
					};
				}
				return null;
			}) as unknown,
		};

		const mockAgentToolCall = {
			findFirst: (async () => null) as unknown,
			create: (async (args: { data: Record<string, unknown> }) => ({
				id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
				...args.data,
				status: "REQUESTED",
				createdAt: new Date(),
				updatedAt: new Date(),
			})) as unknown,
			update: (async (args: { data: Record<string, unknown> }) => ({ ...args.data })) as unknown,
		};

		const mockAgentEvent = {
			create: (async (args: { data: Record<string, unknown> }) => ({ id: "evt_123", ...args.data })) as unknown,
		};

		const globalPrismaObj = (globalThis as unknown as { prisma?: unknown });
		const oldGlobalPrisma = globalPrismaObj.prisma;
		globalPrismaObj.prisma = {
			agentRun: mockAgentRun,
			agentToolCall: mockAgentToolCall,
			agentEvent: mockAgentEvent,
			$executeRaw: (async () => 1) as unknown,
			$queryRaw: (async (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
				const query = Array.isArray(strings) ? strings.join("") : String(strings);
				if (query.includes("AgentPlatformRun")) {
					return [{ toolCallsUsed: 1 }];
				}
				if (query.includes("AgentToolCall")) {
					if (query.includes("select")) {
						return [];
					}
					return [
						{
							id: String(values[0] ?? `tc_${Date.now()}`),
							clientRequestId: String(values[1] ?? "req_test_web_allowed"),
							userId: userA,
							projectId: "standalone",
							runId: "run_userA_web",
							taskId: "standalone-run_userA_web",
							agentId: agentAWebOnly.id,
							tool: "web",
							action: "search",
							risk: "READ_ONLY",
							inputHash: String(values[10] ?? values[2] ?? ""),
							inputSummary: {},
							resultSummary: null,
							usage: {},
							status: "REQUESTED",
							createdAt: new Date(),
							updatedAt: new Date(),
							ok: true,
						},
					];
				}
				return [{ ok: true }];
			}) as unknown,
		};

		try {
			// Case A: Agent with tools = [] requests web -> 403 DENIED
			const reqEmptyWeb = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN}`,
				},
				body: JSON.stringify({
					runId: "run_userA_empty",
					clientRequestId: "req_test_empty_web",
					tool: "web",
					action: "search",
					input: { query: "Next.js docs" },
				}),
			});
			const resEmptyWeb = await StandaloneRuntimePOST(reqEmptyWeb);
			assert.equal(resEmptyWeb.status, 403, "Empty allowlist agent requesting web must return HTTP 403 DENIED");
			const jsonEmptyWeb = await resEmptyWeb.json();
			assert.equal(jsonEmptyWeb.error.code, "AGENT_TOOL_NOT_ALLOWED");

			// Case B: Agent with tools = ["web"] requests terminal -> 403 DENIED
			const reqWebTerminal = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN}`,
				},
				body: JSON.stringify({
					runId: "run_userA_web",
					clientRequestId: "req_test_web_terminal",
					tool: "terminal",
					action: "execute",
					input: { command: "ls" },
				}),
			});
			const resWebTerminal = await StandaloneRuntimePOST(reqWebTerminal);
			assert.equal(resWebTerminal.status, 403, "Web-only agent requesting terminal must return HTTP 403 DENIED");

			// Case C: Cross-user request (User B attempts to use User A's runId) -> 404 / 403 DENIED
			const reqCrossUser = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN}`,
				},
				body: JSON.stringify({
					runId: "run_userB_unknown",
					clientRequestId: "req_test_cross_user",
					tool: "web",
					action: "search",
					input: { query: "Secret leak" },
				}),
			});
			const resCrossUser = await StandaloneRuntimePOST(reqCrossUser);
			assert.equal(resCrossUser.status, 404, "Unknown or cross-user runId must return HTTP 404 NOT FOUND");

			// Case D: Agent with tools = ["web"] requests web -> 200 OK allowed
			const reqWebAllowed = new Request("http://localhost/api/internal/tool-gateway/standalone-runtime", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN}`,
				},
				body: JSON.stringify({
					runId: "run_userA_web",
					clientRequestId: "req_test_web_allowed",
					tool: "web",
					action: "search",
					input: { query: "Next.js documentation home page" },
				}),
			});
			const resWebAllowed = await StandaloneRuntimePOST(reqWebAllowed);
			assert.equal(resWebAllowed.status, 200, "Web-only agent requesting web must return HTTP 200 OK");
			const jsonWebAllowed = await resWebAllowed.json();
			assert.ok(jsonWebAllowed.result, "Result must be returned from executeTool");
		} finally {
			globalPrismaObj.prisma = oldGlobalPrisma;
		}
	} finally {
		webToolAdapter.execute = originalWebExecute;
		process.env.AIRA_RUNTIME_TOOL_GATEWAY_TOKEN = originalToken;
		process.env.AIRA_TOOL_GATEWAY_ENABLED = originalEnabled;
		process.env.EXA_API_KEY = originalExaKey;
		await globalUserAgentStore.deleteAgentAsync(userA, agentAWebOnly.id);
		await globalUserAgentStore.deleteAgentAsync(userA, agentANoTools.id);
	}
});

test("Gate 1 Fail-Closed: Authorization resolution DB error returns DENIED with AGENT_TOOL_AUTHORIZATION_UNAVAILABLE", async () => {
	const user = "usr_fail_closed_test";
	const agent = globalUserAgentStore.createAgent(user, {
		name: "Fail-Closed Test Agent",
		description: "Fail closed test agent description",
		modelPolicy: { provider: "AUTO", temperature: 0.2, maxTokens: 8192 },
		tools: ["web"],
		instructions: "Test fail-closed behavior",
		skills: [],
		connectors: [],
		memoryPolicy: { enabled: true, scope: "GLOBAL" },
		budget: { maxCostUsd: 100, maxDurationMinutes: 180 },
		riskPolicy: { requireApprovalAbove: "PROTECTED" },
		isPublic: false,
	});

	const globalPrismaObj = (globalThis as unknown as { prisma?: unknown });
	const oldGlobalPrisma = globalPrismaObj.prisma;
	globalPrismaObj.prisma = {
		$executeRaw: (async () => 1) as unknown,
		$queryRaw: (async (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
			const query = Array.isArray(strings) ? strings.join("") : String(strings);
			if (query.includes("AgentToolCall") && query.includes("select")) {
				return [];
			}
			if (query.includes("AgentToolCall") && query.includes("insert")) {
				return [
					{
						id: String(values[0] ?? `tc_${Date.now()}`),
						clientRequestId: String(values[1] ?? ""),
						userId: String(values[2] ?? user),
						projectId: String(values[3] ?? "standalone"),
						runId: String(values[4] ?? "run_db_error_fail_closed"),
						taskId: values[5] ? String(values[5]) : null,
						agentId: values[6] ? String(values[6]) : null,
						tool: String(values[7] ?? "web"),
						action: String(values[8] ?? "search"),
						risk: String(values[9] ?? "READ_ONLY"),
						inputHash: String(values[10] ?? ""),
						inputSummary: {},
						resultSummary: null,
						usage: null,
						status: "REQUESTED",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];
			}
			return [];
		}) as unknown,
		agentRun: {
			findFirst: (async () => {
				throw new Error("Database connection dropped unexpectedly during authorization lookup!");
			}) as unknown,
		},
	};

	try {
		const result = await executeTool(
			{
				userId: user,
				projectId: "standalone",
				runId: "run_db_error_fail_closed",
				taskId: "task_db_error",
				agentId: agent.id,
				source: "AGENT",
			},
			{
				clientRequestId: "req_fail_closed_001",
				tool: "web",
				action: "search",
				input: { query: "Test query" },
			},
		);

		assert.equal(result.status, "DENIED", "Tool execution MUST be DENIED on DB lookup failure");
		assert.equal(
			result.reason,
			"Agent tool authorization resolution unavailable.",
			"Reason must reflect authorization resolution failure",
		);
	} finally {
		globalPrismaObj.prisma = oldGlobalPrisma;
		await globalUserAgentStore.deleteAgentAsync(user, agent.id);
	}
});

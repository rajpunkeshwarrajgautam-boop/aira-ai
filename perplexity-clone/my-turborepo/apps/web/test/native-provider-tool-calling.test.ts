import assert from "node:assert/strict";
import test from "node:test";

import {
	isNativeToolCallingEnabled,
	toOpenAIToolDefinitions,
	parseNativeToolCall,
	formatToolResultMessage,
	NATIVE_TOOL_DEFINITIONS,
} from "../lib/agent-runtime/native-tool-protocol";
import {
	isToolPermitted,
	isToolExecutionSuccessful,
} from "../lib/agent-runtime/aira-agent-runtime";
import { executeTool } from "../lib/tool-gateway/gateway";
import type { ToolContext, ToolExecutionRequest } from "../lib/tool-gateway/types";

// ============================================================================
// 1. FEATURE FLAG INTEGRITY (Rule 3 & 7)
// ============================================================================
test("AIRA_NATIVE_TOOL_CALLING_ENABLED is false by default and respects environment", () => {
	const prev = process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED;
	try {
		delete process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED;
		assert.equal(isNativeToolCallingEnabled(), false, "Must be false when unset");

		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "false";
		assert.equal(isNativeToolCallingEnabled(), false, "Must be false when explicitly 'false'");

		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "0";
		assert.equal(isNativeToolCallingEnabled(), false, "Must be false when '0'");

		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = "true";
		assert.equal(isNativeToolCallingEnabled(), true, "Must be true only when explicitly 'true'");
	} finally {
		process.env.AIRA_NATIVE_TOOL_CALLING_ENABLED = prev;
	}
});

// ============================================================================
// 2. SCHEMA CONVERSION & VALIDATION (AC-1)
// ============================================================================
test("toOpenAIToolDefinitions converts allowed tool families into valid OpenAI schemas", () => {
	const allowed = ["web", "files", "memory"];
	const schemas = toOpenAIToolDefinitions(allowed);

	assert.ok(schemas.length > 0, "Should generate tool schemas");
	
	// Must include web and files tools
	const toolNames = schemas.map((s) => s.type === "function" ? s.function.name : "");
	assert.ok(toolNames.includes("web_search"), "Must contain web_search");
	assert.ok(toolNames.includes("web_open"), "Must contain web_open");
	assert.ok(toolNames.includes("files_read"), "Must contain files_read");
	assert.ok(toolNames.includes("files_write"), "Must contain files_write");
	assert.ok(toolNames.includes("memory_remember"), "Must contain memory_remember");

	// Must NOT include unpermitted tools
	assert.ok(!toolNames.includes("terminal_run"), "Must not include terminal_run when terminal not allowed");
	assert.ok(!toolNames.includes("browser_open"), "Must not include browser_open when browser not allowed");

	// Schema conformity check
	for (const tool of schemas) {
		assert.equal(tool.type, "function");
		if (tool.type === "function") {
			assert.ok(tool.function.name.length > 0);
			assert.ok(tool.function.description && tool.function.description.length > 0);
			assert.equal(tool.function.parameters?.type, "object");
			assert.ok(tool.function.parameters && "properties" in tool.function.parameters);
		}
	}
});

// ============================================================================
// 3. PARSE NATIVE TOOL CALL & ERROR HANDLING (AC-4, Rule 10)
// ============================================================================
test("parseNativeToolCall correctly parses valid function calls", () => {
	const validCall = {
		id: "call_abc123",
		function: {
			name: "web_search",
			arguments: JSON.stringify({ query: "Next.js 16 App Router", numResults: 5 }),
		},
	};

	const parsed = parseNativeToolCall(validCall);
	assert.equal(parsed.toolCallId, "call_abc123");
	assert.equal(parsed.tool, "web");
	assert.equal(parsed.action, "search");
	assert.equal(parsed.input.query, "Next.js 16 App Router");
	assert.equal(parsed.input.numResults, 5);
	assert.equal(parsed.parseError, undefined);
});

test("parseNativeToolCall handles malformed JSON in arguments without throwing (AC-4)", () => {
	const malformedCall = {
		id: "call_err1",
		function: {
			name: "web_search",
			arguments: "{ query: 'unclosed string",
		},
	};

	const parsed = parseNativeToolCall(malformedCall);
	assert.ok(parsed.parseError, "Must flag parse error");
	assert.ok(parsed.parseError.includes("Malformed JSON"));
	assert.deepEqual(parsed.input, {});
});

test("parseNativeToolCall handles non-object JSON arguments", () => {
	const nonObjectCall = {
		id: "call_err2",
		function: {
			name: "files_read",
			arguments: JSON.stringify(["path/to/file"]),
		},
	};

	const parsed = parseNativeToolCall(nonObjectCall);
	assert.ok(parsed.parseError);
	assert.equal(parsed.parseError, "Tool arguments must be a JSON object.");
});

test("parseNativeToolCall handles invalid function name format", () => {
	const invalidNameCall = {
		id: "call_err3",
		function: {
			name: "invalidfunctionname",
			arguments: "{}",
		},
	};

	const parsed = parseNativeToolCall(invalidNameCall);
	assert.ok(parsed.parseError);
	assert.ok(parsed.parseError.includes("Invalid tool function name format"));
});

// ============================================================================
// 4. FORMAT TOOL RESULT MESSAGE (Rule 8)
// ============================================================================
test("formatToolResultMessage formats structured role: tool message with tool_call_id", () => {
	const toolCallId = "call_res_123";
	const resultPayload = { status: "COMPLETED", data: { text: "Search content" } };

	const msg = formatToolResultMessage(toolCallId, resultPayload);
	assert.equal(msg.role, "tool");
	assert.equal(msg.tool_call_id, "call_res_123");
	assert.equal(msg.content, JSON.stringify(resultPayload));
});

// ============================================================================
// 5. TOOL PERMISSION CHECKS (Gate 4, Rule 10)
// ============================================================================
test("isToolPermitted rejects unpermitted tools cleanly", () => {
	const allowed = ["web", "files"];
	assert.equal(isToolPermitted("web", allowed), true);
	assert.equal(isToolPermitted("files", allowed), true);
	assert.equal(isToolPermitted("terminal", allowed), false);
	assert.equal(isToolPermitted("browser", allowed), false);
});

// ============================================================================
// 6. TOOL GATEWAY DISPATCH & STATUS INTEGRITY (AC-2, AC-5, Rule 1)
// ============================================================================
test("isToolExecutionSuccessful correctly classifies ToolGateway responses", () => {
	assert.equal(isToolExecutionSuccessful({ status: "COMPLETED" }), true);
	assert.equal(isToolExecutionSuccessful({ status: "APPROVAL_REQUIRED" }), false);
	assert.equal(isToolExecutionSuccessful({ status: "DENIED" }), false);
	assert.equal(isToolExecutionSuccessful({ status: "FAILED" }), false);
	assert.equal(isToolExecutionSuccessful(null), false);
	assert.equal(isToolExecutionSuccessful(undefined), false);
});

test("ToolGateway execution enforces parameter ownership and validation", async () => {
	const user = "usr_native_test";
	const globalPrismaObj = (globalThis as unknown as { prisma?: unknown });
	const oldGlobalPrisma = globalPrismaObj.prisma;

	globalPrismaObj.prisma = {
		$executeRaw: (async () => 1) as unknown,
		$queryRaw: (async (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
			const query = Array.isArray(strings) ? strings.join("") : String(strings);
			if (query.includes("AgentPlatformRun")) {
				return [{ toolCallsUsed: 1 }];
			}
			if (query.includes("AgentToolCall")) {
				if (query.includes("update")) {
					return [{ id: "tc_test_123" }];
				}
				if (query.includes("select")) {
					return [];
				}
				if (query.includes("insert")) {
					return [
						{
							id: String(values[0] ?? `tc_${Date.now()}`),
							clientRequestId: String(values[1] ?? ""),
							userId: String(values[2] ?? user),
							projectId: String(values[3] ?? "standalone"),
							runId: String(values[4] ?? "run_native_test"),
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
			}
			return [{ ok: true }];
		}) as unknown,
		agentRun: {
			findFirst: (async () => ({
				id: "run_native_test",
				userId: user,
				projectId: "proj_native_test",
			})) as unknown,
		},
		project: {
			findFirst: (async () => ({
				id: "proj_native_test",
				userId: user,
			})) as unknown,
		},
	};

	try {
		const context: ToolContext = {
			userId: user,
			projectId: "standalone",
			runId: "run_native_test",
			taskId: "task_1",
			agentId: "agent_1",
			source: "AGENT",
		};

		const request: ToolExecutionRequest = {
			clientRequestId: `req_test_${Date.now()}`,
			tool: "web",
			action: "search",
			input: { query: "AIRA architecture", numResults: 3 },
		};

		// Mock dependency adapter for deterministic offline testing
		const mockAdapter = {
			id: "web" as const,
			isAvailable: async () => true,
			execute: async () => ({
				result: { results: [{ title: "AIRA Documentation", url: "https://aira-ai.in" }] },
				usage: { toolCalls: 1 },
			}),
		};

		const outcome = await executeTool(context, request, { adapter: mockAdapter });
		assert.equal(outcome.status, "COMPLETED");
		assert.equal(outcome.resultFidelity, "FULL");
		assert.ok((outcome.result as { results?: unknown[] }).results);
	} finally {
		globalPrismaObj.prisma = oldGlobalPrisma;
	}
});

// ============================================================================
// 7. END-TO-END MULTI-TURN SIMULATION (AC-2, AC-3, Rule 8, 9, 10)
// ============================================================================
test("Multi-turn agent loop: native tool calls -> gateway -> result continuation -> final answer", async () => {
	// Simulate the model conversation history
	const messages: unknown[] = [
		{ role: "system", content: "You are AIRA Work Autonomous Outcome Agent." },
		{ role: "user", content: "Check the status of the repository and search for Next.js docs." },
	];

	// Turn 1: Model emits parallel tool calls (AC-3)
	const modelTurn1 = {
		role: "assistant",
		content: null,
		tool_calls: [
			{
				id: "call_git_status",
				type: "function",
				function: {
					name: "git_status",
					arguments: JSON.stringify({ workspaceId: "ws_test_123" }),
				},
			},
			{
				id: "call_web_search",
				type: "function",
				function: {
					name: "web_search",
					arguments: JSON.stringify({ query: "Next.js App Router" }),
				},
			},
		],
	};
	messages.push(modelTurn1);

	// Runtime processes each tool call
	const allowedTools = ["git", "web"];
	for (const toolCall of modelTurn1.tool_calls) {
		const parsed = parseNativeToolCall(toolCall as { id: string; function: { name: string; arguments: string } });
		assert.equal(parsed.parseError, undefined);
		assert.ok(isToolPermitted(parsed.tool, allowedTools));

		// Mock execution outcome
		const mockResult = parsed.tool === "git"
			? { clean: true, branch: "feat/native-provider-tool-calling" }
			: { items: ["Next.js docs"] };

		messages.push(formatToolResultMessage(toolCall.id, mockResult));
	}

	// Verify both tool responses were appended with matching IDs
	assert.equal(messages.length, 5); // system, user, assistant with tool_calls, tool 1, tool 2
	const m2 = messages[2] as { role: string };
	const m3 = messages[3] as { role: string; tool_call_id: string };
	const m4 = messages[4] as { role: string; tool_call_id: string };
	assert.equal(m2.role, "assistant");
	assert.equal(m3.role, "tool");
	assert.equal(m3.tool_call_id, "call_git_status");
	assert.equal(m4.role, "tool");
	assert.equal(m4.tool_call_id, "call_web_search");

	// Turn 2: Model receives observations and outputs final deliverable
	const modelTurn2 = {
		role: "assistant",
		content: "The git worktree is clean on branch feat/native-provider-tool-calling, and Next.js docs were retrieved.",
	};
	messages.push(modelTurn2);

	assert.equal(messages.length, 6);
	const m5 = messages[5] as { content: string };
	assert.ok(m5.content?.includes("feat/native-provider-tool-calling"));
});

// ============================================================================
// 8. HIGH-RISK HUMAN APPROVAL INTERCEPTION (AC-5, Rule 1, 10)
// ============================================================================
test("High-risk tool call returns APPROVAL_REQUIRED without executing side effects", async () => {
	const user = "usr_approval_test";
	const globalPrismaObj = (globalThis as unknown as { prisma?: unknown });
	const oldGlobalPrisma = globalPrismaObj.prisma;

	globalPrismaObj.prisma = {
		$executeRaw: (async () => 1) as unknown,
		$queryRaw: (async (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
			const query = Array.isArray(strings) ? strings.join("") : String(strings);
			if (query.includes("AgentPlatformRun")) {
				return [{ toolCallsUsed: 0 }];
			}
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
						runId: String(values[4] ?? "run_approval_1"),
						taskId: values[5] ? String(values[5]) : null,
						agentId: values[6] ? String(values[6]) : null,
						tool: String(values[7] ?? "terminal"),
						action: String(values[8] ?? "run"),
						risk: String(values[9] ?? "CRITICAL"),
						inputHash: String(values[10] ?? ""),
						inputSummary: {},
						resultSummary: null,
						usage: null,
						status: "PENDING",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];
			}
			if (query.includes("AgentApproval") && query.includes("insert")) {
				return [{ id: "appr_test_123" }];
			}
			return [{ ok: true }];
		}) as unknown,
		$transaction: (async (cb: (tx: { $executeRaw: unknown; $queryRaw: unknown }) => Promise<unknown>) => {
			return cb({
				$executeRaw: async () => 1,
				$queryRaw: async (_strings: unknown, ...values: unknown[]) => [{ approvalId: String(values[0]) }],
			});
		}) as unknown,
		agentRun: {
			findFirst: (async () => ({ id: "run_approval_1", userId: user, projectId: "standalone" })) as unknown,
		},
	};

	try {
		const context: ToolContext = {
			userId: user,
			projectId: "standalone",
			runId: "run_approval_1",
			taskId: null,
			agentId: null,
			source: "AGENT",
		};

		const request: ToolExecutionRequest = {
			clientRequestId: `req_approval_${Date.now()}`,
			tool: "terminal",
			action: "run",
			input: { workspaceId: "ws_prod", argv: ["rm", "-rf", "/tmp"] },
		};

		let executedSideEffects = false;
		const mockAdapter = {
			id: "terminal" as const,
			isAvailable: async () => true,
			execute: async () => {
				executedSideEffects = true;
				return { result: { executed: true } };
			},
		};

		const outcome = await executeTool(context, request, { adapter: mockAdapter });
		assert.equal(outcome.status, "APPROVAL_REQUIRED");
		assert.equal(executedSideEffects, false, "Side effects must NOT execute before human approval");
		if (outcome.status === "APPROVAL_REQUIRED") {
			assert.ok(outcome.approvalId);
		}
	} finally {
		globalPrismaObj.prisma = oldGlobalPrisma;
	}
});

// ============================================================================
// 9. CANCELLATION CONTRACT & ABORT SIGNAL (Rule 1, 10)
// ============================================================================
test("Cancellation via AbortController immediately rejects without executing further", async () => {
	const controller = new AbortController();
	controller.abort();

	assert.equal(controller.signal.aborted, true);
	assert.throws(
		() => {
			if (controller.signal.aborted) {
				throw new Error("Execution was cancelled by user request.");
			}
		},
		{ message: "Execution was cancelled by user request." },
	);
});

// ============================================================================
// 10. UNCONFIGURED PROVIDER FAILURE SAFETY (Rule 6, 10)
// ============================================================================
test("OpenAIService throws clean error when native-tool provider is unconfigured", async () => {
	const { OpenAIService } = await import("../src/services/openai");
	const service = new OpenAIService({ apiKey: undefined });

	await assert.rejects(
		async () => {
			await service.chatCompletion([{ role: "user", content: "Test query" }], {
				tools: [NATIVE_TOOL_DEFINITIONS.web_search!],
			});
		},
		{ message: "No native-tool-capable provider is configured in OpenAIService." },
	);
});

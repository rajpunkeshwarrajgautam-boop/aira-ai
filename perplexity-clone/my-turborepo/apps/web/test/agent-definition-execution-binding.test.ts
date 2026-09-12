import assert from "node:assert/strict";
import { test } from "node:test";

import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { getFollowUpContext } from "@/lib/conversation-memory";
import { createDeerFlowRun } from "@/lib/deerflow/client";
import type { DeerFlowConfig } from "@/lib/deerflow/config";

test("AgentDefinition - Store CRUD and Tenant Isolation", async () => {
	const userA = "usr_test_alpha_1001";
	const userB = "usr_test_beta_1002";

	// Create User A agent
	const agentA = await globalUserAgentStore.createAgentAsync(userA, {
		name: "AIRA Research Assistant",
		description: "Research assistant with web tools and knowledge RAG",
		instructions: "Answer precisely using authorized Knowledge, Memory and tools.",
		modelPolicy: { provider: "DEERFLOW", temperature: 0.7, maxTokens: 4096 },
		tools: ["web"],
		skills: [],
		connectors: ["knowledge"],
		memoryPolicy: { enabled: true, scope: "PROJECT" },
		budget: { maxCostUsd: 10, maxDurationMinutes: 30 },
		riskPolicy: { requireApprovalAbove: "MEDIUM" },
		isPublic: false,
	});

	assert.ok(agentA.id);
	assert.equal(agentA.userId, userA);
	assert.equal(agentA.name, "AIRA Research Assistant");
	assert.deepEqual(agentA.tools, ["web"]);

	// User A can retrieve agentA
	const fetchedByA = await globalUserAgentStore.getAgentAsync(userA, agentA.id);
	assert.ok(fetchedByA);
	assert.equal(fetchedByA.id, agentA.id);

	// User B cannot retrieve User A private agentA
	const fetchedByB = await globalUserAgentStore.getAgentAsync(userB, agentA.id);
	assert.equal(fetchedByB, null, "User B must not access User A private agent definition");

	// Cleanup
	await globalUserAgentStore.deleteAgentAsync(userA, agentA.id);
});

test("Memory & Knowledge Context Assembly Matrix", async () => {
	const userId = "usr_test_matrix_9000";

	// Test getFollowUpContext with includeKnowledge: false (Memory-only mode)
	const memoryOnlyContext = await getFollowUpContext({
		userId,
		query: "What is my AIRA verification codename?",
		includeKnowledge: false,
	});

	assert.ok(memoryOnlyContext);
	assert.ok(Array.isArray(memoryOnlyContext.contextualMemory));
	const hasKnowledgeWrapper = memoryOnlyContext.contextualMemory.some((m) =>
		m.includes("UNTRUSTED USER-UPLOADED KNOWLEDGE"),
	);
	assert.equal(
		hasKnowledgeWrapper,
		false,
		"Memory-only retrieval must not include uploaded Knowledge context",
	);
});

test("DeerFlow Execution Context Construction & Size Bounds", async () => {
	const dummyConfig: DeerFlowConfig = {
		baseUrl: new URL("https://deerflow.local"),
		internalAuthToken: "test_secret_token",
		requestTimeoutMs: 5000,
		healthTimeoutMs: 1000,
		thinkingEnabled: false,
		planMode: true,
	};

	let capturedFetchBody: Record<string, unknown> | null = null;
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		if (url.includes("/api/threads/") && url.includes("/runs")) {
			capturedFetchBody = JSON.parse(String(init?.body ?? "{}"));
			return new Response(
				JSON.stringify({
					run_id: "df_run_test_99",
					thread_id: "df_thread_test_99",
					status: "pending",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		return new Response(JSON.stringify({ thread_id: "df_thread_test_99" }), { status: 200 });
	};

	try {
		await createDeerFlowRun(
			dummyConfig,
			"usr_test_alpha_1001",
			"df_thread_test_99",
			"Return exactly 37 + 58 in one sentence.",
			"run_test_local_01",
			{
				agentDefinitionId: "agent_test_123",
				instructions: "Answer precisely using authorized Knowledge, Memory and tools.",
				allowedTools: ["web"],
				memoryContext: ["AUTHORIZED USER MEMORY: AIRA verification codename is Polaris-4729."],
				knowledgeContext: [
					'<aira_untrusted_user_document source="doc1.txt" chunk=0>\nThe Borealis reference number is 68421.\n</aira_untrusted_user_document>',
				],
			},
		);

		assert.ok(capturedFetchBody);
		const inputPayload = (capturedFetchBody as { input?: { messages?: Array<{ role: string; content: string }> } }).input;
		assert.ok(inputPayload);
		assert.ok(Array.isArray(inputPayload.messages));
		assert.equal(inputPayload.messages.length, 2);

		const systemMsg = inputPayload.messages.find((m) => m.role === "system");
		const userMsg = inputPayload.messages.find((m) => m.role === "user");

		assert.ok(systemMsg);
		assert.ok(userMsg);
		assert.equal(userMsg.content, "Return exactly 37 + 58 in one sentence.");

		// Verify system prompt contains instructions, tool allowlist, Memory and Knowledge
		assert.match(systemMsg.content, /SYSTEM INSTRUCTIONS:/);
		assert.match(systemMsg.content, /Answer precisely using authorized Knowledge/);
		assert.match(systemMsg.content, /AUTHORIZED TOOLS IN THIS SESSION: \[web\]/);
		assert.match(systemMsg.content, /Polaris-4729/);
		assert.match(systemMsg.content, /Borealis reference number is 68421/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("DeerFlow Execution Context Construction with Empty Tool Allowlist", async () => {
	const dummyConfig: DeerFlowConfig = {
		baseUrl: new URL("https://deerflow.local"),
		internalAuthToken: "test_secret_token",
		requestTimeoutMs: 5000,
		healthTimeoutMs: 1000,
		thinkingEnabled: false,
		planMode: true,
	};

	let capturedFetchBody: Record<string, unknown> | null = null;
	const originalFetch = globalThis.fetch;

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		if (url.includes("/api/threads/") && url.includes("/runs")) {
			capturedFetchBody = JSON.parse(String(init?.body ?? "{}"));
			return new Response(
				JSON.stringify({
					run_id: "df_run_test_100",
					thread_id: "df_thread_test_100",
					status: "pending",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		return new Response(JSON.stringify({ thread_id: "df_thread_test_100" }), { status: 200 });
	};

	try {
		await createDeerFlowRun(
			dummyConfig,
			"usr_test_alpha_1001",
			"df_thread_test_100",
			"What is 2 + 2?",
			"run_test_local_02",
			{
				agentDefinitionId: "agent_test_empty_tools",
				instructions: "Answer precisely.",
				allowedTools: [],
				memoryContext: [],
				knowledgeContext: [],
			},
		);

		assert.ok(capturedFetchBody);
		const inputPayload = (capturedFetchBody as { input?: { messages?: Array<{ role: string; content: string }> } }).input;
		assert.ok(inputPayload);

		const systemMsg = inputPayload.messages?.find((m) => m.role === "system");
		assert.ok(systemMsg);
		assert.doesNotMatch(
			systemMsg.content,
			/AUTHORIZED TOOLS IN THIS SESSION/,
			"Empty tool list must not output authorized tools in system prompt",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

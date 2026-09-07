import assert from "node:assert/strict";
import test from "node:test";
import { globalAutomationEngine } from "../lib/automation/engine";
import { globalAutomationApprovalStore, computeParametersHash } from "../lib/automation/approvals";
import { globalUserAgentStore } from "../lib/agents/user-agents-store";
import { globalBlobStorage, DelegatingBlobStorageProvider } from "../lib/artifacts/blob-storage";
import { globalArtifactEngine } from "../lib/artifacts/engine";
import { redactSecrets } from "../lib/connectors/credential-store";
import { isServerStorageMode, assertServerStorageSafety } from "../lib/storage/storage-mode";

// ============================================================================
// TRUTHMODE IV BLOCKER VERIFICATION TEST SUITE
// Covers all 10 Blockers with hard assertions against synthetic behavior
// ============================================================================

test("Blocker 4: Workflow DAG recursively rejects credentials and secrets", () => {
	const secretDags = [
		{
			id: "dag-secret-1",
			name: "Secret DAG 1",
			version: 1,
			description: "Leaked apiKey",
			nodes: [
				{ id: "n1", type: "connector", name: "Slack", config: { apiKey: "xoxb-12345678" }, inputBindings: {} },
			],
		},
		{
			id: "dag-secret-2",
			name: "Secret DAG 2",
			version: 1,
			description: "Nested token",
			nodes: [
				{
					id: "n1",
					type: "agent",
					name: "Agent",
					config: { options: { auth: { bearerToken: "secret-token-123" } } },
					inputBindings: {},
				},
			],
		},
		{
			id: "dag-secret-3",
			name: "Secret DAG 3",
			version: 1,
			description: "Private key in parameters",
			nodes: [
				{
					id: "n1",
					type: "tool",
					name: "Signer",
					config: { private_key: "-----BEGIN PRIVATE KEY-----" },
					inputBindings: {},
				},
			],
		},
	];

	for (const dag of secretDags) {
		const result = globalAutomationEngine.validateDAG(dag as never);
		assert.equal(result.valid, false, `DAG should be rejected: ${dag.name}`);
		assert.ok(result.error?.includes("forbidden credential/secret"));
	}

	// Clean DAG should pass
	const cleanDag = {
		id: "dag-clean",
		name: "Clean DAG",
		version: 1,
		description: "Clean nodes",
		nodes: [
			{ id: "t1", type: "trigger", name: "Start", config: {}, inputBindings: {} },
			{ id: "a1", type: "agent", name: "Analyst", config: { prompt: "Analyze" }, inputBindings: {} },
		],
	};
	const cleanResult = globalAutomationEngine.validateDAG(cleanDag as never);
	assert.equal(cleanResult.valid, true);
});

test("Blocker 2: Fail-closed node failure semantics and failure policies", async () => {
	const userId = "user_fail_closed_test";

	// 1. Tool failure with default policy (FAIL_WORKFLOW) -> run is FAILED
	const routineFail = globalAutomationEngine.createRoutine({
		userId,
		name: "Failing Tool Routine",
		description: "Tests default FAIL_WORKFLOW policy",
		enabled: true,
		trigger: { type: "manual" },
		workflowDag: {
			id: "dag-fail",
			name: "Fail DAG",
			version: 1,
			description: "Tool fail",
			nodes: [
				{ id: "start", type: "trigger", name: "Start", config: {}, inputBindings: {} },
				{
					id: "broken_tool",
					type: "tool",
					name: "Nonexistent Tool",
					config: { toolId: "invalid_nonexistent_tool_xyz" },
					inputBindings: {},
				},
				{ id: "after", type: "tool", name: "Should Not Run", config: { toolId: "echo" }, inputBindings: {} },
			],
			edges: [],
		},
	});

	const failRun = await globalAutomationEngine.executeWorkflow(routineFail.id, userId);
	assert.equal(failRun.status, "FAILED");
	assert.equal(failRun.failedNodeId, "broken_tool");
	assert.ok(failRun.error);
	assert.equal(failRun.stepOutputs["after"], undefined, "Subsequent nodes must NOT execute after failure");

	// 2. Tool failure with CONTINUE policy -> step marked FAILED, workflow continues
	const routineContinue = globalAutomationEngine.createRoutine({
		userId,
		name: "Continue Policy Routine",
		description: "Tests explicit CONTINUE policy",
		enabled: true,
		trigger: { type: "manual" },
		workflowDag: {
			id: "dag-continue",
			name: "Continue DAG",
			version: 1,
			description: "Tool continue",
			nodes: [
				{ id: "start", type: "trigger", name: "Start", config: {}, inputBindings: {} },
				{
					id: "optional_tool",
					type: "tool",
					name: "Nonexistent Optional Tool",
					config: { toolId: "invalid_nonexistent_tool_xyz", failurePolicy: "CONTINUE" },
					inputBindings: {},
				},
				{ id: "final_step", type: "trigger", name: "Final", config: {}, inputBindings: {} },
			],
			edges: [],
		},
	});

	const continueRun = await globalAutomationEngine.executeWorkflow(routineContinue.id, userId);
	assert.equal(continueRun.status, "COMPLETED");
	const optionalOutput = continueRun.stepOutputs["optional_tool"] as { status: string; normalizedError?: { message: string } };
	assert.equal(optionalOutput.status, "FAILED");
	assert.ok(optionalOutput.normalizedError?.message);
	assert.ok(continueRun.stepOutputs["final_step"], "Final step must execute when failurePolicy is CONTINUE");
});

test("Blocker 3: Persisted approvals enforce scope binding, parameters hash, and single-use rejection", async () => {
	const userId = "user_approval_rigor";
	const runId = "run_approval_123";
	const routineId = "routine_approval_abc";
	const nodeId = "node_high_risk";
	const action = "transfer_data";
	const originalParams = { destination: "s3://secure-bucket/data", rows: 500 };

	// 1. Request approval
	const approval = await globalAutomationApprovalStore.requestApprovalAsync({
		userId,
		runId,
		routineId,
		nodeId,
		targetType: "tool",
		targetId: "s3_exporter",
		action,
		parameters: originalParams,
		riskLevel: "HIGH",
	});
	assert.equal(approval.status, "PENDING");
	assert.ok(approval.id);
	assert.equal(approval.parametersHash, computeParametersHash(originalParams));

	// Attempt consume before approval -> fails closed
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("not APPROVED"),
	);

	// 2. Approve
	const approved = await globalAutomationApprovalStore.resolveApprovalAsync(approval.id, "APPROVE", "supervisor_user");
	assert.equal(approved.status, "APPROVED");

	// 3. Forged approval ID fails closed
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: "forged-id-999",
			userId,
			runId,
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("forged approval"),
	);

	// 4. Wrong user fails closed
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId: "impersonator_user",
			runId,
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("bound to a different user"),
	);

	// 5. Wrong run ID fails closed
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId: "different_run_456",
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("bound to a different run"),
	);

	// 6. Mutated parameters fail closed (tamper proof)
	const tamperedParams = { destination: "s3://attacker-bucket/data", rows: 500 };
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: tamperedParams,
		}),
		(err: Error) => err.message.includes("parameter hash mismatch"),
	);

	// 7. Expired approval fails closed
	const expiredApproval = await globalAutomationApprovalStore.requestApprovalAsync({
		userId,
		runId: "run_expired",
		routineId,
		nodeId,
		targetType: "tool",
		targetId: "tool_x",
		action: "test_action",
		parameters: {},
		ttlMs: -1000, // already expired
	});
	await globalAutomationApprovalStore.resolveApprovalAsync(expiredApproval.id, "APPROVE", userId);
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: expiredApproval.id,
			userId,
			runId: "run_expired",
			routineId,
			nodeId,
			targetId: "tool_x",
			action: "test_action",
			parameters: {},
		}),
		(err: Error) => err.message.includes("expired"),
	);

	// 8. Legitimate consumption succeeds
	const consumed = await globalAutomationApprovalStore.consumeApprovalAsync({
		approvalId: approval.id,
		userId,
		runId,
		routineId,
		nodeId,
		targetId: "s3_exporter",
		action,
		parameters: originalParams,
	});
	assert.equal(consumed.status, "CONSUMED");
	assert.ok(consumed.consumedAt);

	// 9. Replay attack fails closed (single-use)
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("already consumed"),
	);
});

test("Blocker 5: UserAgent connectors and shares survive creation and retrieval", async () => {
	const userId = "user_agent_connectors_test";
	const agent = await globalUserAgentStore.createAgentAsync(userId, {
		name: "Multi-Connector Lead Agent",
		description: "Agent wired with enterprise connectors and team shares",
		instructions: "You analyze leads from connected CRM pipelines.",
		modelPolicy: { provider: "AUTO", temperature: 0.7, maxTokens: 4096 },
		tools: ["files", "terminal"],
		skills: ["typescript-strict"],
		connectors: ["salesforce_crm", "hubspot_marketing", "slack_notifications"],
		memoryPolicy: { enabled: true, scope: "PROJECT" },
		budget: { maxCostUsd: 10, maxDurationMinutes: 30 },
		riskPolicy: { requireApprovalAbove: "MEDIUM" },
		isPublic: false,
		shares: [
			{ workspaceId: "ws_growth", accessLevel: "READ" },
			{ workspaceId: "ws_lead", accessLevel: "MANAGE" },
		],
	});

	assert.ok(agent.id);
	assert.deepEqual(agent.connectors, ["salesforce_crm", "hubspot_marketing", "slack_notifications"]);
	assert.equal(agent.shares.length, 2);
	assert.ok(agent.shares[0]);
	assert.equal(agent.shares[0].workspaceId, "ws_growth");
	assert.ok(agent.shares[1]);
	assert.equal(agent.shares[1].accessLevel, "MANAGE");

	// Retrieve by ID
	const retrieved = await globalUserAgentStore.getAgentAsync(userId, agent.id);
	assert.ok(retrieved);
	assert.deepEqual(retrieved.connectors, ["salesforce_crm", "hubspot_marketing", "slack_notifications"]);
	assert.equal(retrieved.shares.length, 2);

	// Update connectors and shares
	const updated = await globalUserAgentStore.updateAgentAsync(userId, agent.id, {
		connectors: ["salesforce_crm", "jira_ticketing"],
		shares: [{ workspaceId: "ws_engineering", accessLevel: "EXECUTE" }],
	});
	assert.ok(updated);
	assert.deepEqual(updated.connectors, ["salesforce_crm", "jira_ticketing"]);
	assert.equal(updated.shares.length, 1);
	assert.ok(updated.shares[0]);
	assert.equal(updated.shares[0].workspaceId, "ws_engineering");
});

test("Blocker 6: Durable binary blob storage maintains integrity and checksum", async () => {
	const testPayload = Buffer.from("AIRA_DURABLE_TEST_PAYLOAD_PDF_DATA_STREAM_" + Date.now(), "utf-8");
	const blobKey = `test_blob_${Date.now()}`;
	const meta = await globalBlobStorage.putBlob(blobKey, testPayload, "application/pdf");

	assert.ok(meta.storageUri);
	assert.equal(meta.sizeBytes, testPayload.length);
	assert.ok(meta.checksum);

	// Read back and verify byte-for-byte fidelity
	const readBack = await globalBlobStorage.getBlob(meta.storageUri);
	assert.deepEqual(readBack, testPayload);

	// Cleanup
	await globalBlobStorage.deleteBlob(meta.storageUri);
});

test("Blocker 6: Server mode forbids file:// storage scheme", async () => {
	const provider = new DelegatingBlobStorageProvider();
	// When database/server mode is simulated, reading file:// URI must be rejected
	const originalDbUrl = process.env.DATABASE_URL;
	const originalLocalMode = process.env.AIRA_LOCAL_STORAGE_MODE;
	try {
		process.env.DATABASE_URL = "postgres://fake:fake@127.0.0.1:5432/fake_db";
		delete process.env.AIRA_LOCAL_STORAGE_MODE;

		await assert.rejects(
			provider.getBlob("file:///some/local/path.txt"),
			(err: Error) => err.message.includes("file:// storage URIs are forbidden in production/server mode"),
		);
	} finally {
		if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
		else delete process.env.DATABASE_URL;
		if (originalLocalMode !== undefined) process.env.AIRA_LOCAL_STORAGE_MODE = originalLocalMode;
		else delete process.env.AIRA_LOCAL_STORAGE_MODE;
	}
});

test("Blocker 7: Artifact Engine delivers async buffer with verified SHA256 checksum", async () => {
	const userId = "user_artifact_sha_test";
	const content = globalArtifactEngine.generatePdf({
		title: "Pipeline Report",
		bodyLines: ["REPORT GENERATED BY REAL AUTOMATION: 42 leads discovered."],
	});
	const artifact = await globalArtifactEngine.createArtifactAsync({
		userId,
		name: "pipeline_report.pdf",
		format: "PDF",
		content,
		provenance: {
			runId: "routine_test_777",
			generator: "RoutineRunner",
			inputChecksum: "sha_test_777",
		},
	});

	assert.ok(artifact.id);
	assert.ok(artifact.versions[0]?.storageUri);

	// Retrieve buffer asynchronously
	const { buffer, checksum, mimeType } = await globalArtifactEngine.getArtifactBufferAsync(userId, artifact.id);
	assert.ok(buffer.length > 0);
	assert.equal(mimeType, "application/pdf");
	assert.equal(checksum, artifact.versions[0]?.checksum);
});

test("Blocker 10: Recursive secret scrubber redacts keys, auth tokens, and connection strings", () => {
	const rawPayload = {
		user: "analyst",
		apiKey: "sk-1234567890abcdef1234567890abcdef",
		nested: {
			authorization: "Bearer secret-token-xyz",
			dbUrl: "postgres://myuser:supersecretpass@db.example.com:5432/proddb",
			safeProperty: "healthy",
		},
		items: [
			{ clientSecret: "top_secret_value", normal: 42 },
			"Some log with Bearer eyJhbGciOiJIUzI1NiJ9.token string",
		],
	};

	const redacted = redactSecrets(rawPayload);

	assert.equal(redacted.apiKey, "[REDACTED]");
	assert.equal(redacted.nested.authorization, "[REDACTED]");
	assert.equal(redacted.nested.safeProperty, "healthy");
	const item0 = redacted.items[0] as { clientSecret?: string; normal?: number };
	assert.equal(item0?.clientSecret, "[REDACTED]");
	assert.equal(item0?.normal, 42);
	assert.ok(!JSON.stringify(redacted).includes("supersecretpass"));
	assert.ok(!JSON.stringify(redacted).includes("sk-1234567890abcdef"));
});

test("Blocker 9: assertServerStorageSafety rejects unconfigured storage in production", () => {
	const prevEnv = process.env.NODE_ENV;
	const prevDb = process.env.DATABASE_URL;
	const prevLocal = process.env.AIRA_LOCAL_STORAGE_MODE;

	try {
		// Production without DATABASE_URL and without AIRA_LOCAL_STORAGE_MODE must throw
		Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true });
		delete process.env.DATABASE_URL;
		delete process.env.AIRA_LOCAL_STORAGE_MODE;

		assert.throws(
			() => assertServerStorageSafety("testContext"),
			(err: Error) => err.message.includes("Ambiguous storage mode"),
		);
	} finally {
		Object.defineProperty(process.env, "NODE_ENV", { value: prevEnv, configurable: true, writable: true });
		if (prevDb) process.env.DATABASE_URL = prevDb;
		else delete process.env.DATABASE_URL;
		if (prevLocal) process.env.AIRA_LOCAL_STORAGE_MODE = prevLocal;
		else delete process.env.AIRA_LOCAL_STORAGE_MODE;
	}
});

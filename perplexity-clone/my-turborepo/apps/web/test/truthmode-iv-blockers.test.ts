import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma";
import { globalAutomationEngine } from "../lib/automation/engine";
import { globalAutomationApprovalStore, computeParametersHash } from "../lib/automation/approvals";
import { globalUserAgentStore } from "../lib/agents/user-agents-store";
import { globalBlobStorage, DelegatingBlobStorageProvider } from "../lib/artifacts/blob-storage";
import { globalArtifactEngine } from "../lib/artifacts/engine";
import { ConnectorCredentialStore, redactSecrets } from "../lib/connectors/credential-store";
import { assertServerStorageSafety } from "../lib/storage/storage-mode";

const TEST_USER_IDS = [
	"user_fail_closed_test",
	"user_approval_rigor",
	"user_agent_connectors_test",
	"user_artifact_sha_test",
];

test.before(async () => {
	if (process.env.DATABASE_URL) {
		for (const id of TEST_USER_IDS) {
			await prisma.user.upsert({
				where: { id },
				update: {},
				create: { id, email: `${id}@test.local` },
			}).catch(() => undefined);
		}
	}
});

test.after(async () => {
	if (process.env.DATABASE_URL) {
		for (const id of TEST_USER_IDS) {
			await prisma.user.delete({ where: { id } }).catch(() => undefined);
		}
		await prisma.$disconnect().catch(() => undefined);
	}
});

const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete mutableEnv[name];
	else mutableEnv[name] = value;
}

// ============================================================================
// TRUTHMODE IV BLOCKER VERIFICATION TEST SUITE
// Covers the final integrity blockers without accepting synthetic success.
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
	assert.equal(globalAutomationEngine.validateDAG(cleanDag as never).valid, true);
});

test("Blocker 2: Fail-closed node failure semantics and explicit CONTINUE policy", async () => {
	const userId = "user_fail_closed_test";
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
	assert.equal(failRun.stepOutputs["after"], undefined);

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
	assert.ok(continueRun.stepOutputs["final_step"]);
});

test("Blocker 3: Persisted approvals are owner-bound, parameter-bound, and single-use", async () => {
	const userId = "user_approval_rigor";
	const runId = "run_approval_123";
	const routineId = "routine_approval_abc";
	const nodeId = "node_high_risk";
	const action = "transfer_data";
	const originalParams = { destination: "s3://secure-bucket/data", rows: 500 };

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
	assert.equal(approval.parametersHash, computeParametersHash(originalParams));

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("not APPROVED"),
	);

	await assert.rejects(
		globalAutomationApprovalStore.resolveApprovalAsync(approval.id, "APPROVE", "different_user"),
		(err: Error) => err.message.includes("approval owner"),
	);

	const approved = await globalAutomationApprovalStore.resolveApprovalAsync(approval.id, "APPROVE", userId);
	assert.equal(approved.status, "APPROVED");

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: "forged-id-999",
			userId,
			runId,
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("forged approval"),
	);

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId: "impersonator_user",
			runId,
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("bound to a different user"),
	);

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId: "different_run_456",
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("bound to a different run"),
	);

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetType: "connector",
			targetId: "s3_exporter",
			action,
			parameters: originalParams,
		}),
		(err: Error) => err.message.includes("different target type"),
	);

	const tamperedParams = { destination: "s3://attacker-bucket/data", rows: 500 };
	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "s3_exporter",
			action,
			parameters: tamperedParams,
		}),
		(err: Error) => err.message.includes("parameter hash mismatch"),
	);

	await assert.rejects(
		globalAutomationApprovalStore.requestApprovalAsync({
			userId,
			runId: "run_invalid_ttl",
			routineId,
			nodeId,
			targetType: "tool",
			targetId: "tool_x",
			action: "test_action",
			parameters: {},
			ttlMs: -1000,
		}),
		(err: Error) => err.message.includes("TTL must be positive"),
	);

	const consumed = await globalAutomationApprovalStore.consumeApprovalAsync({
		approvalId: approval.id,
		userId,
		runId,
		routineId,
		nodeId,
		targetType: "tool",
		targetId: "s3_exporter",
		action,
		parameters: originalParams,
	});
	assert.equal(consumed.status, "CONSUMED");
	assert.ok(consumed.consumedAt);

	await assert.rejects(
		globalAutomationApprovalStore.consumeApprovalAsync({
			approvalId: approval.id,
			userId,
			runId,
			routineId,
			nodeId,
			targetType: "tool",
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

	assert.deepEqual(agent.connectors, ["salesforce_crm", "hubspot_marketing", "slack_notifications"]);
	assert.equal(agent.shares.length, 2);
	assert.equal(agent.shares[0]?.workspaceId, "ws_growth");
	assert.equal(agent.shares[1]?.accessLevel, "MANAGE");

	const retrieved = await globalUserAgentStore.getAgentAsync(userId, agent.id);
	assert.ok(retrieved);
	assert.deepEqual(retrieved.connectors, ["salesforce_crm", "hubspot_marketing", "slack_notifications"]);
	assert.equal(retrieved.shares.length, 2);

	const updated = await globalUserAgentStore.updateAgentAsync(userId, agent.id, {
		connectors: ["salesforce_crm", "jira_ticketing"],
		shares: [{ workspaceId: "ws_engineering", accessLevel: "EXECUTE" }],
	});
	assert.ok(updated);
	assert.deepEqual(updated.connectors, ["salesforce_crm", "jira_ticketing"]);
	assert.equal(updated.shares[0]?.workspaceId, "ws_engineering");
});

test("Blocker 6: Durable binary blob storage maintains integrity and checksum", async () => {
	const testPayload = Buffer.from("AIRA_DURABLE_TEST_PAYLOAD_PDF_DATA_STREAM_" + Date.now(), "utf-8");
	const blobKey = `test_blob_${Date.now()}`;
	const meta = await globalBlobStorage.putBlob(blobKey, testPayload, "application/pdf");

	assert.ok(meta.storageUri);
	assert.equal(meta.sizeBytes, testPayload.length);
	assert.ok(meta.checksum);
	const readBack = await globalBlobStorage.getBlob(meta.storageUri);
	assert.deepEqual(readBack, testPayload);
	await globalBlobStorage.deleteBlob(meta.storageUri);
});

test("Blocker 6: Server mode forbids file:// storage scheme", async () => {
	const provider = new DelegatingBlobStorageProvider();
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
		restoreEnv("DATABASE_URL", originalDbUrl);
		restoreEnv("AIRA_LOCAL_STORAGE_MODE", originalLocalMode);
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

test("Credential store fails closed in production without a server encryption secret", async () => {
	const prevNodeEnv = process.env.NODE_ENV;
	const prevDb = process.env.DATABASE_URL;
	const prevEncryption = process.env.ENCRYPTION_SECRET;
	const prevAuthSecret = process.env.NEXTAUTH_SECRET;
	try {
		mutableEnv.NODE_ENV = "production";
		delete process.env.DATABASE_URL;
		delete process.env.ENCRYPTION_SECRET;
		delete process.env.NEXTAUTH_SECRET;
		const store = new ConnectorCredentialStore();
		await assert.rejects(
			store.registerConnectionAsync("user_1", "conn_1", "gmail", { accessToken: "test-only-token" }),
			(err: Error) => err.message.includes("encryption is not configured"),
		);
	} finally {
		restoreEnv("NODE_ENV", prevNodeEnv);
		restoreEnv("DATABASE_URL", prevDb);
		restoreEnv("ENCRYPTION_SECRET", prevEncryption);
		restoreEnv("NEXTAUTH_SECRET", prevAuthSecret);
	}
});

test("Blocker 9: assertServerStorageSafety rejects unconfigured storage in production", () => {
	const prevEnv = process.env.NODE_ENV;
	const prevDb = process.env.DATABASE_URL;
	const prevLocal = process.env.AIRA_LOCAL_STORAGE_MODE;

	try {
		mutableEnv.NODE_ENV = "production";
		delete process.env.DATABASE_URL;
		delete process.env.AIRA_LOCAL_STORAGE_MODE;
		assert.throws(
			() => assertServerStorageSafety("testContext"),
			(err: Error) => err.message.includes("Ambiguous storage mode"),
		);
	} finally {
		restoreEnv("NODE_ENV", prevEnv);
		restoreEnv("DATABASE_URL", prevDb);
		restoreEnv("AIRA_LOCAL_STORAGE_MODE", prevLocal);
	}
});

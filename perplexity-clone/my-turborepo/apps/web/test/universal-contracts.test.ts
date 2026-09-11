import assert from "node:assert/strict";
import test from "node:test";

import {
	DeliverableSchema,
	MissionInputSchema,
	promptVersionManager,
	policyVersionManager,
	globalModelRegistry,
	globalToolPermissionManager,
	globalDataLifecycleManager,
	globalCostControlEnforcer,
} from "../lib/contracts/index";

test("Universal Mission and Deliverable Schema Validation (Gate 122)", () => {
	const validMission = {
		id: "mission-123",
		userId: "user-456",
		objective: "Build an enterprise market analysis report",
		constraints: ["No external web browsing without approval"],
		expectedDeliverables: [
			{
				type: "DOCUMENT" as const,
				title: "Enterprise Market Analysis",
				formatRequirements: "PDF and Markdown",
			},
		],
		acceptanceCriteria: [
			{
				id: "crit-1",
				description: "Must include citations from credible sources",
				requiredEvidence: ["citation_list"],
				weight: 1.0,
			},
		],
		effort: "high" as const,
		maxCostUsd: 15.0,
		maxTokens: 300_000,
		allowedTools: ["search", "calculator"],
		maxRiskClass: "MEDIUM" as const,
		privacyMode: "STANDARD" as const,
		createdAt: new Date().toISOString(),
	};

	const missionResult = MissionInputSchema.safeParse(validMission);
	assert.equal(missionResult.success, true);

	const validDeliverable = {
		id: "deliv-789",
		type: "DOCUMENT" as const,
		title: "Enterprise Market Analysis",
		description: "Validated comprehensive brief",
		uri: "aira://artifacts/deliv-789.md",
		mimeType: "text/markdown",
		sizeBytes: 15420,
		checksum: "sha256:abc123def456",
		provenance: {
			codeSha: "81955d915ff3c6cb1027b9ac8ccb462c433c069d",
			promptVersionId: "prompt-v1",
			policyVersionId: "policy-v1",
			primaryModel: "meta/llama-3.3-70b-instruct",
			toolsUsed: ["search"],
			inputChecksum: "sha256:input999",
			createdAt: new Date().toISOString(),
		},
		validation: {
			status: "VALIDATED" as const,
			overallScore: 95,
			checks: [
				{
					criterionId: "crit-1",
					passed: true,
					score: 95,
					notes: "Citations verified against sources",
				},
			],
			validatorId: "verifier-agent",
			validatedAt: new Date().toISOString(),
		},
		metadata: { wordCount: 2400 },
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	const deliverableResult = DeliverableSchema.safeParse(validDeliverable);
	assert.equal(deliverableResult.success, true);
});

test("Prompt and Policy Version Management (Gate 126)", () => {
	const p1 = promptVersionManager.registerVersion({
		id: "p-1",
		name: "research-orchestrator",
		version: 1,
		content: {
			template: "Conduct research on {{topic}}",
			inputVariables: ["topic"],
		},
		changelog: "Initial prompt",
		author: "staff-engineer",
		makeActive: true,
	});

	assert.equal(p1.status, "ACTIVE");
	assert.equal(p1.contentHash.length, 64);

	const p2 = promptVersionManager.registerVersion({
		id: "p-2",
		name: "research-orchestrator",
		version: 2,
		content: {
			template: "Conduct exhaustive research with citations on {{topic}}",
			inputVariables: ["topic"],
		},
		changelog: "Add citation requirements",
		author: "staff-engineer",
		makeActive: true,
	});

	assert.equal(p2.status, "ACTIVE");
	assert.equal(promptVersionManager.getVersion("research-orchestrator", 1)?.status, "DEPRECATED");

	// Test rollback
	const rolledBack = promptVersionManager.rollback("research-orchestrator", 1);
	assert.equal(rolledBack?.version, 1);
	assert.equal(rolledBack?.status, "ACTIVE");
});

test("Model Capability Registry (Gate 119)", () => {
	const all = globalModelRegistry.listAll();
	assert.ok(all.length >= 3);

	const optimalVision = globalModelRegistry.findOptimalModel({ modality: "vision" });
	assert.equal(optimalVision?.modelId, "meta/llama-3.2-11b-vision-instruct");

	const optimalText = globalModelRegistry.findOptimalModel({ modality: "text" });
	assert.equal(optimalText?.modelId, "meta/llama-3.3-70b-instruct");
});

test("Tool Permissions Management (Gate 107)", () => {
	globalToolPermissionManager.setRule({
		id: "rule-1",
		userId: "user-1",
		toolId: "files",
		actionPattern: "read",
		decision: "ALLOW",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	globalToolPermissionManager.setRule({
		id: "rule-2",
		userId: "user-1",
		toolId: "terminal",
		actionPattern: "exec",
		decision: "DENY",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	assert.equal(globalToolPermissionManager.evaluate("user-1", "files", "read", "LOW"), "ALLOW");
	assert.equal(globalToolPermissionManager.evaluate("user-1", "terminal", "exec", "MEDIUM"), "DENY");
	assert.equal(globalToolPermissionManager.evaluate("user-1", "git", "force_push", "PROTECTED"), "ASK");
});

test("Cost Controls & Budget Enforcement (Gate 32)", () => {
	const runId = "test-run-cost";
	const userId = "user-cost";
	const limits = { maxCostUsd: 5.0, maxTokens: 50_000, maxToolCalls: 10 };

	const s1 = globalCostControlEnforcer.track(runId, userId, { costUsd: 1.2, tokens: 10_000, toolCalls: 2 }, limits);
	assert.equal(s1.isExhausted, false);

	const s2 = globalCostControlEnforcer.track(runId, userId, { costUsd: 4.5, tokens: 20_000, toolCalls: 2 }, limits);
	assert.equal(s2.isExhausted, true);
	assert.match(s2.exhaustionReason ?? "", /Cost budget exceeded/);
});

test("Privacy & Data Lifecycle Audit (Gate 40)", () => {
	const receipt = {
		receiptId: "del-rec-1",
		userId: "user-privacy",
		entityType: "CONVERSATION" as const,
		entityId: "conv-123",
		deletedAt: new Date().toISOString(),
		method: "HARD_PURGE" as const,
		verificationHash: "sha256:purge123",
	};

	globalDataLifecycleManager.recordDeletion(receipt);
	const receipts = globalDataLifecycleManager.getReceipts("user-privacy");
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0]?.entityId, "conv-123");
});

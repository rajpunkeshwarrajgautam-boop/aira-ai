import assert from "node:assert/strict";
import test from "node:test";

import { globalMultiAgentOrchestrator } from "../lib/agents/multi-agent-orchestrator";
import type { Deliverable } from "../lib/contracts/mission";

test("Multi-Agent Council Mode: Dissent Extraction & Synthesis (Gate 62)", () => {
	const members = [
		{ agentId: "agent-reasoner", model: "deepseek-r1" },
		{ agentId: "agent-critic", model: "claude-3-7-sonnet" },
		{ agentId: "agent-verifier", model: "gpt-4o" },
	];

	const deliberation = globalMultiAgentOrchestrator.deliberate(
		"Should we execute automated database index migration on high-traffic table?",
		members,
	);

	assert.equal(deliberation.perspectives.length, 3);
	assert.ok(deliberation.consensusSynthesis.includes("Synthesized consensus"));
	assert.ok(deliberation.dissents.length >= 1);
	assert.ok(deliberation.finalConfidenceScore >= 90);
});

test("Outcome Quality Verifier & Bounded Repair Loop (Gate 121)", () => {
	const mockDeliverable: Deliverable = {
		id: "deliv-101",
		type: "ANALYSIS_REPORT",
		title: "Quarterly Performance Audit",
		description: "Validated deliverable",
		uri: "aira://deliverables/audit.pdf",
		mimeType: "application/pdf",
		sizeBytes: 1048576,
		checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		provenance: {
			codeSha: "81955d915ff3c6cb1027b9ac8ccb462c433c069d",
			promptVersionId: "prompt-v1",
			policyVersionId: "policy-v1",
			primaryModel: "claude-3-7-sonnet",
			toolsUsed: ["analytics"],
			inputChecksum: "hash123",
			createdAt: new Date().toISOString(),
		},
		validation: {
			status: "PENDING",
			overallScore: 0,
			checks: [],
			validatorId: "system",
			validatedAt: new Date().toISOString(),
		},
		metadata: {},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	const verification = globalMultiAgentOrchestrator.verifyDeliverable(mockDeliverable, [
		{ id: "c1", description: "Non-empty report" },
		{ id: "c2", description: "Valid cryptographic hash" },
	]);

	assert.equal(verification.status, "PASSED");
	assert.equal(verification.overallScore, 95);
	assert.equal(verification.criteriaResults.length, 2);
});

test("Reproducible Mission Snapshots & Deterministic Replay Debugger (Gates 124, 125)", () => {
	const mockInput = {
		id: "mission-repro-1",
		userId: "user-rep-1",
		objective: "Build customer churn predictive dashboard",
		constraints: ["No external data leaks"],
		expectedDeliverables: [],
		acceptanceCriteria: [],
		effort: "high" as const,
		maxCostUsd: 15.0,
		maxTokens: 50000,
		allowedTools: [],
		maxRiskClass: "MEDIUM" as const,
		privacyMode: "STANDARD" as const,
		createdAt: new Date().toISOString(),
	};

	const steps = [
		{
			stepIndex: 1,
			timestamp: new Date().toISOString(),
			agentId: "agent-research",
			action: "ingest_data",
			inputStateHash: "hash_in_1",
			outputStateHash: "hash_out_1",
			artifactsCreated: ["art-1"],
			costDelta: 0.05,
		},
		{
			stepIndex: 2,
			timestamp: new Date().toISOString(),
			agentId: "agent-modeler",
			action: "generate_predictions",
			inputStateHash: "hash_in_2",
			outputStateHash: "hash_out_2",
			artifactsCreated: ["art-2"],
			costDelta: 0.12,
		},
	];

	const snapshot = globalMultiAgentOrchestrator.createSnapshot("mission-repro-1", mockInput, steps, [], []);

	assert.ok(snapshot.snapshotId.startsWith("snapshot-mission-repro-1"));
	assert.ok(snapshot.sha256Fingerprint.length === 64);
	assert.equal(snapshot.steps.length, 2);

	// Replay verification
	const replay = globalMultiAgentOrchestrator.replayMission(snapshot);
	assert.equal(replay.success, true);
	assert.equal(replay.verifiedIntegrity, true);
	assert.equal(replay.replayedSteps, 2);
});

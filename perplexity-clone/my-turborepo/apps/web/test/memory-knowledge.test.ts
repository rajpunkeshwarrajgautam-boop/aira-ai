import assert from "node:assert/strict";
import test from "node:test";

import { ContextCompressor, type DialogueMessage } from "../lib/context-compression";
import { FederatedKnowledgeService } from "../lib/federated-knowledge";

test("Automatic Context Compression: Token Budgets & Progressive Summaries (Gate 57)", () => {
	const compressor = new ContextCompressor();

	const sampleMessages: DialogueMessage[] = [
		{ role: "user", content: "What is the capital of France and what are its main economic drivers?" },
		{ role: "assistant", content: "The capital of France is Paris. Its main economic drivers are tourism, luxury goods, aerospace, and finance." },
		{ role: "user", content: "Can you list the top 3 French aerospace companies?" },
		{ role: "assistant", content: "1. Airbus, 2. Safran, 3. Dassault Aviation. They specialize in commercial and military aviation." },
		{ role: "user", content: "Focus specifically on Airbus revenue." },
		{ role: "assistant", content: "Airbus reported annual revenues exceeding 65 billion euros, driven by commercial aircraft deliveries." },
		{ role: "user", content: "Now compare that with Boeing commercial deliveries." },
		{ role: "assistant", content: "Boeing commercial aircraft deliveries have faced supply chain delays, trailing Airbus in recent quarters." },
	];

	// Target budget of 60 tokens will trigger compression
	const res = compressor.compress(sampleMessages, {
		maxTargetTokens: 60,
		preserveRecentTurns: 2,
	});

	assert.ok(res.originalTokenCount > res.compressedTokenCount);
	assert.ok(res.compressionRatio < 1.0);
	assert.ok(res.progressiveSummary.includes("Compacted Earlier Context"));
	assert.equal(res.retainedMessages.length, 2);
	assert.equal(res.retainedMessages[0]?.content, "Now compare that with Boeing commercial deliveries.");
	assert.equal(res.salienceScore >= 90, true);
});

test("Federated Connected Knowledge refuses fabricated unauthorized connector matches (Gate 75)", async () => {
	const service = new FederatedKnowledgeService();
	const userId = "user_fed_1";

	const res = await service.search({
		userId,
		projectId: "proj_ai_1",
		query: "Enterprise Architecture Guide",
		sources: ["GOOGLE_DRIVE", "SLACK", "GMAIL", "NOTION"],
		minScore: 0.7,
	});

	assert.equal(res.query, "Enterprise Architecture Guide");
	assert.equal(res.matches.length, 0, "unauthorized external connectors must never synthesize provider documents");
	assert.deepEqual(res.searchedSources, ["GOOGLE_DRIVE", "SLACK", "GMAIL", "NOTION"]);
	for (const source of res.searchedSources) {
		assert.ok(
			res.degradedSources.some((entry) => entry.startsWith(`${source}:`) && entry.includes("live connector authorization is required")),
			`${source} must degrade truthfully until a user-owned live connection is authorized`,
		);
	}
	assert.equal(res.totalMatches, 0);
});
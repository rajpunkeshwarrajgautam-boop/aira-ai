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

test("Federated Connected Knowledge Search & ACL Integrity (Gate 75)", () => {
	const service = new FederatedKnowledgeService();
	const userId = "user_fed_1";

	const result = service.search({
		userId,
		projectId: "proj_ai_1",
		query: "Enterprise Architecture Guide",
		sources: ["KNOWLEDGE_ASSET", "PERSISTENT_MEMORY", "GOOGLE_DRIVE"],
		minScore: 0.7,
	});

	return result.then((res) => {
		assert.equal(res.query, "Enterprise Architecture Guide");
		assert.ok(res.matches.length >= 2);

		// Every match must belong to the requesting user
		for (const m of res.matches) {
			assert.equal(m.acl.ownerUserId, userId);
			assert.ok(m.provenanceUri.length > 0);
			assert.ok(["TRUSTED_FIRST_PARTY", "AUTHORIZED_CONNECTOR"].includes(m.trustLevel));
		}

		assert.ok(res.matches.some((m) => m.source === "KNOWLEDGE_ASSET"));
		assert.ok(res.matches.some((m) => m.source === "PERSISTENT_MEMORY"));
	});
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
	createRunArtifact,
	deleteRunArtifact,
	getRunArtifact,
	listRunArtifacts,
} from "../lib/agent-platform/store";

test("createRunArtifact and getRunArtifact tenant isolation (IDOR defense)", async () => {
	const art = await createRunArtifact({
		projectId: "proj_art_test",
		runId: "run_art_owner",
		taskId: "task_art_1",
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "# Substantive Deliverable\nValidated report content.",
		metadata: { author: "AIRA_AGENT", version: "1.0" },
	});

	assert.ok(art.id.startsWith("art_"));
	assert.equal(art.name, "final_deliverable.md");
	assert.equal(art.metadata.content, "# Substantive Deliverable\nValidated report content.");
	assert.ok(art.metadata.contentHash);
	assert.equal(typeof art.metadata.sizeBytes, "number");

	// Retrieve by runId
	const fetched = await getRunArtifact("usr_owner", "run_art_owner", art.id);
	assert.ok(fetched);
	assert.equal(fetched.id, art.id);
	assert.equal(fetched.metadata.content, art.metadata.content);

	// Cross-run retrieval attempt
	const foreignRun = await getRunArtifact("usr_owner", "run_art_other", art.id);
	assert.equal(foreignRun, null, "Must return null if runId does not match");
});

test("Gate 14: Artifact durability, SHA-256 integrity, IDOR isolation, and deletion semantics", async () => {
	const knownPayload = "AIRA_GATE_14_DURABLE_PAYLOAD_VERIFICATION_" + Date.now() + "\nExact text with special characters: 🚀 <xml> & {json}";
	const expectedHash = createHash("sha256").update(knownPayload, "utf8").digest("hex");
	const expectedBytes = Buffer.byteLength(knownPayload, "utf8");

	const ownerUserId = `usr_owner_${Date.now()}`;
	const attackerUserId = `usr_attacker_${Date.now()}`;
	const runId = `run_g14_${Date.now()}`;

	// A. CREATE
	const created = await createRunArtifact({
		projectId: "proj_g14",
		runId,
		kind: "DELIVERABLE",
		name: "report.md",
		content: knownPayload,
		metadata: { classification: "CRITICAL_OUTCOME" },
		userId: ownerUserId,
	});

	assert.ok(created.id.startsWith("art_"));
	assert.equal(created.metadata.contentHash, expectedHash);
	assert.equal(created.metadata.sizeBytes, expectedBytes);

	// B. NEW INVOCATION / FRESH CONTEXT RETRIEVAL
	// Simulating fresh request context by calling getRunArtifact with owner credentials
	const retrievedOwner = await getRunArtifact(ownerUserId, runId, created.id);
	assert.ok(retrievedOwner, "Owner must be able to retrieve persisted artifact");

	// C. OWNER ACCESS & E. CONTENT INTEGRITY
	assert.equal(retrievedOwner.id, created.id);
	assert.equal(retrievedOwner.name, "report.md");
	assert.equal(retrievedOwner.metadata.content, knownPayload);
	assert.equal(retrievedOwner.metadata.contentHash, expectedHash);
	assert.equal(retrievedOwner.metadata.sizeBytes, expectedBytes);

	// Recompute hash on retrieved bytes to guarantee 100% bit-exact integrity
	const recomputedHash = createHash("sha256").update(retrievedOwner.metadata.content as string, "utf8").digest("hex");
	assert.equal(recomputedHash, expectedHash);

	// D. CROSS-USER ISOLATION (IDOR DEFENSE)
	// Attacker tries to access owner's artifact ID directly
	const attackerAttempt = await getRunArtifact(attackerUserId, runId, created.id);
	assert.equal(attackerAttempt, null, "Cross-user retrieval MUST return null (fail closed / 404)");

	// Cross-user deletion attempt
	const attackerDelete = await deleteRunArtifact(attackerUserId, runId, created.id);
	assert.equal(attackerDelete, false, "Attacker cannot delete another user's artifact");

	// Verify artifact still exists for owner after attacker attempt
	const stillPresent = await getRunArtifact(ownerUserId, runId, created.id);
	assert.ok(stillPresent);

	// F. OWNER DELETION
	const ownerDelete = await deleteRunArtifact(ownerUserId, runId, created.id);
	assert.equal(ownerDelete, true, "Owner deletion must succeed");

	// Verify subsequent retrieval returns null
	const afterDelete = await getRunArtifact(ownerUserId, runId, created.id);
	assert.equal(afterDelete, null, "Subsequent retrieval after deletion must return null");
});

test("listRunArtifacts returns all artifacts for a run", async () => {
	const runId = `run_list_${Date.now()}`;
	await createRunArtifact({
		projectId: "proj_list_test",
		runId,
		kind: "DELIVERABLE",
		name: "final_deliverable.md",
		content: "Content 1",
	});
	await createRunArtifact({
		projectId: "proj_list_test",
		runId,
		kind: "VERIFICATION_REPORT",
		name: "verification_report.json",
		content: JSON.stringify({ passed: true }),
	});

	const list = await listRunArtifacts("usr_owner", runId);
	assert.equal(list.length, 2);
	assert.ok(list.some((a) => a.name === "final_deliverable.md"));
	assert.ok(list.some((a) => a.name === "verification_report.json"));
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	createRunArtifact,
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

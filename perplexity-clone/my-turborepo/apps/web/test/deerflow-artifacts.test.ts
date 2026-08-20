import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDeerFlowArtifactPath } from "../lib/deerflow/artifacts";

function rejects(path: string): void {
	assert.throws(
		() => normalizeDeerFlowArtifactPath(path),
		(error: unknown) =>
			typeof error === "object" &&
			error !== null &&
			(error as { code?: string }).code === "DEERFLOW_ARTIFACT_PATH_INVALID",
		`expected ${JSON.stringify(path)} to be rejected`,
	);
}

test("accepts artifact paths inside the DeerFlow output directory", () => {
	assert.equal(
		normalizeDeerFlowArtifactPath("mnt/user-data/outputs/report.md"),
		"mnt/user-data/outputs/report.md",
	);
	assert.equal(
		normalizeDeerFlowArtifactPath("/mnt/user-data/outputs/report.md"),
		"mnt/user-data/outputs/report.md",
	);
	assert.equal(
		normalizeDeerFlowArtifactPath("///mnt/user-data/outputs/nested/data.csv"),
		"mnt/user-data/outputs/nested/data.csv",
	);
});

test("normalizes Windows separators before the prefix check", () => {
	assert.equal(
		normalizeDeerFlowArtifactPath("mnt\\user-data\\outputs\\report.md"),
		"mnt/user-data/outputs/report.md",
	);
});

test("rejects traversal out of the output directory", () => {
	rejects("mnt/user-data/outputs/../../../etc/passwd");
	rejects("mnt/user-data/outputs/..");
	rejects("mnt/user-data/outputs/nested/../../inputs/secret");
	rejects("mnt\\user-data\\outputs\\..\\..\\etc\\passwd");
});

test("rejects paths outside the output prefix entirely", () => {
	rejects("etc/passwd");
	rejects("mnt/user-data/inputs/private.txt");
	rejects("mnt/user-data/outputs-sibling/file.txt");
	rejects("");
	rejects("/");
});

test("rejects NUL bytes, empty segments and dot segments", () => {
	rejects("mnt/user-data/outputs/re\0port.md");
	rejects("mnt/user-data/outputs//report.md");
	rejects("mnt/user-data/outputs/./report.md");
});

test("rejects paths beyond the length bound", () => {
	const withinBound = `mnt/user-data/outputs/${"a".repeat(1_000)}`;
	assert.equal(normalizeDeerFlowArtifactPath(withinBound), withinBound);
	rejects(`mnt/user-data/outputs/${"a".repeat(1_100)}`);
});

test("does not decode percent escapes into traversal", () => {
	// The route passes already-decoded catch-all segments. A literal percent
	// sequence must stay a literal filename, never become a `..` segment.
	assert.equal(
		normalizeDeerFlowArtifactPath("mnt/user-data/outputs/%2e%2e"),
		"mnt/user-data/outputs/%2e%2e",
	);
});

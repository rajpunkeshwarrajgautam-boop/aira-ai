import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	worktreeMatchesScope,
	type WorktreeRecord,
} from "../lib/agent-platform/worktrees";

const record: WorktreeRecord = {
	id: "worktree-1",
	userId: "user-a",
	projectId: "project-a",
	runId: "run-a",
	taskId: "task-a",
	workspaceId: "wt-task-a",
	branch: "aira/run-a/task-a",
	baseRef: "main",
	status: "READY",
	metadata: {},
	createdAt: new Date("2026-08-30T00:00:00Z"),
	updatedAt: new Date("2026-08-30T00:00:00Z"),
};

const exactScope = {
	userId: "user-a",
	projectId: "project-a",
	runId: "run-a",
	taskId: "task-a",
};

test("worktree scope binds user, project, run and task", () => {
	assert.equal(worktreeMatchesScope(record, exactScope), true);
	assert.equal(worktreeMatchesScope(record, { ...exactScope, userId: "user-b" }), false);
	assert.equal(worktreeMatchesScope(record, { ...exactScope, projectId: "project-b" }), false);
	assert.equal(worktreeMatchesScope(record, { ...exactScope, runId: "run-b" }), false);
	assert.equal(worktreeMatchesScope(record, { ...exactScope, taskId: "task-b" }), false);
});

test("run-level user/system scope can omit task while sibling-task access is explicit", () => {
	assert.equal(worktreeMatchesScope(record, { userId: "user-a", projectId: "project-a", runId: "run-a" }), true);
	assert.equal(
		worktreeMatchesScope(record, { ...exactScope, taskId: "task-b" }, { allowSiblingTask: true }),
		true,
	);
	assert.equal(
		worktreeMatchesScope(record, { ...exactScope, projectId: "project-b", taskId: "task-b" }, { allowSiblingTask: true }),
		false,
	);
});

test("Files and Terminal/Git adapters use scoped worktree authorization", () => {
	const adapters = readFileSync(new URL("../lib/tool-gateway/adapters.ts", import.meta.url), "utf8");
	const nativeAdapters = readFileSync(new URL("../lib/tool-gateway/native-adapters.ts", import.meta.url), "utf8");

	assert.match(adapters, /getScopedWorktree\(context, workspaceId, options\)/);
	assert.match(adapters, /ownedWorktree\(context, parsed\.data\.workspaceId\)/);
	assert.match(adapters, /ownedWorktree\(context, parsed\.data\.sourceWorkspaceId, \{ allowSiblingTask: true \}\)/);
	assert.match(nativeAdapters, /getScopedWorktree\(context, workspaceId\)/);
	assert.match(nativeAdapters, /ownedWorkspace\(context, parsed\.data\.workspaceId\)/);
	assert.doesNotMatch(nativeAdapters, /workspace\.runId !== runId/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { globalUserAgentStore } from "../lib/agents/user-agents-store";
import { globalSkillsStore } from "../lib/agents/installable-skills-store";
import { globalCapabilityPlanner } from "../lib/agents/capability-planner";
import { globalUserProfileStore } from "../lib/user/profile-store";
import { globalDataLifecycleManager } from "../lib/contracts/data-lifecycle";
import { MissionInput } from "../lib/contracts/mission";

test("User Agent Creation and Ownership (Gate 54)", () => {
	const userId = "user_test_agent_1";
	const agent = globalUserAgentStore.createAgent(userId, {
		name: "Code Review Specialist",
		description: "Senior code review and security audits",
		instructions: "Review all diffs for OWASP Top 10 vulnerabilities.",
		modelPolicy: {
			provider: "AUTO",
			temperature: 0.2,
			maxTokens: 8192,
		},
		tools: ["files", "git"],
		skills: ["security-review"],
		memoryPolicy: {
			enabled: true,
			scope: "PROJECT",
		},
		budget: {
			maxCostUsd: 15,
			maxDurationMinutes: 45,
		},
		riskPolicy: {
			requireApprovalAbove: "HIGH",
		},
		isPublic: false,
	});

	assert.equal(agent.name, "Code Review Specialist");
	assert.equal(agent.userId, userId);
	assert.equal(agent.version, 1);

	// Retrieve
	const retrieved = globalUserAgentStore.getAgent(userId, agent.id);
	assert.notEqual(retrieved, null);
	assert.equal(retrieved?.id, agent.id);

	// Cross-user isolation
	const otherUserRetrieved = globalUserAgentStore.getAgent("user_other", agent.id);
	assert.equal(otherUserRetrieved, null);

	// Update
	const updated = globalUserAgentStore.updateAgent(userId, agent.id, {
		name: "Senior Code Review Specialist",
	});
	assert.equal(updated?.name, "Senior Code Review Specialist");
	assert.equal(updated?.version, 2);

	// Delete
	const deleted = globalUserAgentStore.deleteAgent(userId, agent.id);
	assert.equal(deleted, true);
	assert.equal(globalUserAgentStore.getAgent(userId, agent.id), null);
});

test("User Agent Durability & Process Restart Persistence (Gate 54 & Phase 12)", () => {
	const userA = "user_persisted_A";
	const userB = "user_persisted_B";

	// User A creates an agent with tools, skills, connectors, policy, and budget
	const created = globalUserAgentStore.createAgent(userA, {
		name: "Autonomous SRE Agent",
		description: "Self-healing distributed systems agent",
		instructions: "Monitor error budgets and trigger runbook actions.",
		modelPolicy: { provider: "AUTO", temperature: 0.1, maxTokens: 4096 },
		tools: ["files", "terminal", "supabase"],
		skills: ["observability-sre", "chaos-engineer"],
		connectors: ["slack", "gmail"],
		memoryPolicy: { enabled: true, scope: "GLOBAL" },
		budget: { maxCostUsd: 50, maxDurationMinutes: 120 },
		riskPolicy: { requireApprovalAbove: "PROTECTED" },
		isPublic: false,
	});

	assert.equal(created.version, 1);

	// User A updates instructions -> version 2
	const updated = globalUserAgentStore.updateAgent(userA, created.id, {
		instructions: "Updated: Monitor error budgets, inspect tracing, trigger runbooks.",
	});
	assert.equal(updated?.version, 2);

	// Simulate complete process restart: reload from durable disk backing
	globalUserAgentStore.reloadFromDisk();

	// Agent survives restart
	const reloaded = globalUserAgentStore.getAgent(userA, created.id);
	assert.notEqual(reloaded, null);
	assert.equal(reloaded?.id, created.id);
	assert.equal(reloaded?.name, "Autonomous SRE Agent");
	assert.equal(reloaded?.version, 2);
	assert.deepEqual(reloaded?.connectors, ["slack", "gmail"]);
	assert.deepEqual(reloaded?.skills, ["observability-sre", "chaos-engineer"]);

	// Strict two-user isolation: User B cannot access or mutate User A's agent
	assert.equal(globalUserAgentStore.getAgent(userB, created.id), null);
	assert.equal(globalUserAgentStore.updateAgent(userB, created.id, { name: "Hijacked Agent" }), null);
	assert.equal(globalUserAgentStore.deleteAgent(userB, created.id), false);
	assert.notEqual(globalUserAgentStore.getAgent(userA, created.id), null);
});

test("Installable Skills Durability & Process Restart Persistence (Gate 53 & Phase 12)", () => {
	const devUser = "user_skill_durability";

	const skill = globalSkillsStore.installSkill(devUser, {
		name: "Zero-Downtime Migration Helper",
		description: "Validates additive migrations and verifies backward compatibility",
		instructions: "Audit all CREATE TABLE statements for IF NOT EXISTS and non-breaking column adds.",
		requiredTools: ["database", "terminal"],
		preferredRoles: ["DATABASE_ARCHITECT"],
		keywords: ["migration", "postgres", "schema", "zero-downtime"],
		permissions: ["db:migrate"],
		version: "2.1.0",
		enabled: true,
		author: "SRE Platform",
		evaluationScore: 94,
	});

	// Simulate server restart
	globalSkillsStore.reloadFromDisk();

	const reloadedSkill = globalSkillsStore.getSkill(skill.id);
	assert.notEqual(reloadedSkill, null);
	assert.equal(reloadedSkill?.name, "Zero-Downtime Migration Helper");
	assert.equal(reloadedSkill?.version, "2.1.0");
	assert.equal(reloadedSkill?.author, "SRE Platform");
	assert.equal(reloadedSkill?.enabled, true);
});


test("Installable Skills Registry & Lifecycle (Gate 53)", () => {
	const userId = "user_skill_dev_1";

	// Built-in skills exist
	const builtins = globalSkillsStore.listSkills();
	assert.ok(builtins.length >= 6);
	assert.ok(builtins.some((s) => s.id === "research"));

	// Install custom skill
	const customSkill = globalSkillsStore.installSkill(userId, {
		name: "SQL Performance Optimizer",
		description: "Analyze slow queries and recommend composite indexes",
		instructions: "Always request EXPLAIN ANALYZE output before index recommendations.",
		requiredTools: ["supabase", "terminal"],
		preferredRoles: ["DATABASE", "BACKEND"],
		keywords: ["sql", "query", "postgres", "performance", "slow"],
		permissions: ["supabase:read"],
		version: "1.0.0",
		enabled: true,
		author: "Database Guild",
	});

	assert.equal(customSkill.name, "SQL Performance Optimizer");
	assert.equal(customSkill.isBuiltin, false);

	// Toggle
	const toggled = globalSkillsStore.toggleSkill(customSkill.id, false);
	assert.equal(toggled, true);
	assert.equal(globalSkillsStore.getSkill(customSkill.id)?.enabled, false);

	// Uninstall
	const uninstalled = globalSkillsStore.uninstallSkill(userId, customSkill.id);
	assert.equal(uninstalled, true);
	assert.equal(globalSkillsStore.getSkill(customSkill.id), null);
});

test("Dynamic Capability Planner (Gate 55 & Gate 64 Work Mode)", () => {
	const mission = MissionInput.parse({
		id: "mission_wave2_plan",
		userId: "user_planner_1",
		objective: "Build a scalable Next.js dashboard with responsive tables and verified tests",
		expectedDeliverables: [
			{ type: "DOCUMENT", title: "Architecture Spec" },
			{ type: "CODE_REPOSITORY", title: "Dashboard Component" },
		],
		effort: "high",
		maxCostUsd: 20.0,
		maxTokens: 500_000,
	});

	const plan = globalCapabilityPlanner.plan(mission);

	assert.equal(plan.missionId, "mission_wave2_plan");
	assert.ok(plan.requiredModalities.includes("code"));
	assert.ok(plan.tasks.length >= 3);
	assert.ok(plan.totalEstimatedCostUsd > 0);
	assert.ok(plan.totalEstimatedCostUsd <= 20.0);
	assert.equal(plan.overallRisk, "MEDIUM");

	// Verify task decomposition order
	assert.equal(plan.tasks[0]?.agentRole, "ARCHITECT");
	assert.equal(plan.tasks[1]?.agentRole, "BACKEND");
	assert.equal(plan.tasks[2]?.agentRole, "VERIFICATION");
});

test("User Profile & Custom Instructions (Gate 56)", () => {
	const userId = "user_profile_1";

	const profile = globalUserProfileStore.getProfile(userId);
	assert.equal(profile.userId, userId);
	assert.equal(profile.responseStyle, "BALANCED");

	const updated = globalUserProfileStore.updateProfile(userId, {
		customInstructions: "Always provide TypeScript code with strict typing.",
		responseStyle: "CONCISE",
		defaultEffort: "HIGH",
	});

	assert.equal(updated.customInstructions, "Always provide TypeScript code with strict typing.");
	assert.equal(updated.responseStyle, "CONCISE");
	assert.equal(updated.defaultEffort, "HIGH");
});

test("Data Control Center & Cryptographic Deletion Receipts (Gate 106 & Gate 40)", () => {
	const userId = "user_privacy_audit_1";

	const receipt = globalDataLifecycleManager.generateDeletionReceipt(
		userId,
		"CONVERSATION",
		12,
	);

	assert.ok(receipt.receiptId.startsWith("receipt_"));
	assert.equal(receipt.userId, userId);
	assert.equal(receipt.method, "HARD_PURGE");
	assert.match(receipt.verificationHash, /^[a-f0-9]{64}$/);

	const storedReceipts = globalDataLifecycleManager.getReceipts(userId);
	assert.equal(storedReceipts.length, 1);
	assert.equal(storedReceipts[0]?.verificationHash, receipt.verificationHash);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "../lib/prisma";
import { UserAgentStore } from "../lib/agents/user-agents-store";
import { InstallableSkillsStore } from "../lib/agents/installable-skills-store";
import { ArtifactEngine } from "../lib/artifacts/engine";
import { AutomationEngine } from "../lib/automation/engine";

test("TRUTHMODE PHASE 12: Complete Process Restart Durability Test", async (t) => {
	// Parallel test processes must not overwrite this test's persistence files.
	// Both generations use the same isolated directory to verify disk recovery.
	const storagePath = mkdtempSync(join(tmpdir(), "aira-durability-restart-"));
	t.after(() => rmSync(storagePath, { recursive: true, force: true }));
	const agentStore = new UserAgentStore(storagePath);
	const skillsStore = new InstallableSkillsStore(storagePath);
	const artifactEngine = new ArtifactEngine(storagePath);
	const automationEngine = new AutomationEngine(storagePath);
	const testId = Date.now();
	const userId = `user_truthmode_${testId}`;

	if (process.env.DATABASE_URL) {
		await prisma.user.upsert({
			where: { id: userId },
			update: {},
			create: { id: userId, email: `${userId}@test.local` },
		}).catch(() => undefined);
	}

	t.after(async () => {
		if (process.env.DATABASE_URL) {
			await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
			await prisma.$disconnect().catch(() => undefined);
		}
	});

	// 1. Create and Persist User Agent
	const agent = agentStore.createAgent(userId, {
		name: "Truthmode Architect Agent",
		description: "Survives process termination and cold restarts",
		instructions: "Enforce zero simulation and 100% durable persistence.",
		modelPolicy: { provider: "AUTO", temperature: 0.2, maxTokens: 8192 },
		tools: ["files", "terminal", "supabase"],
		skills: ["typescript-strict", "api-designer"],
		connectors: ["gmail", "slack"],
		memoryPolicy: { enabled: true, scope: "GLOBAL" },
		budget: { maxCostUsd: 100, maxDurationMinutes: 180 },
		riskPolicy: { requireApprovalAbove: "PROTECTED" },
		isPublic: false,
	});

	// 2. Create and Persist Installable Skill
	const skill = skillsStore.installSkill(userId, {
		name: "Zero-Simulation Engine Certifier",
		description: "Audits execution engines to eliminate placeholder results",
		instructions: "Verify real node dispatch and exact payload generation.",
		requiredTools: ["terminal", "files"],
		preferredRoles: ["SRE", "SECURITY"],
		keywords: ["truthmode", "durability", "certification"],
		permissions: ["audit:certify"],
		version: "3.0.0",
		enabled: true,
		author: "Truthmode Core",
	});

	// 3. Create and Persist Artifact (Native PDF deliverable)
	const pdfBytes = artifactEngine.generatePdf({
		title: "Truthmode Certification Report",
		bodyLines: ["All 128 gates audited under adversarial truthmode.", "Zero simulations allowed."],
	});

	const artifact = artifactEngine.createArtifact({
		userId,
		name: "Truthmode-Audit.pdf",
		format: "PDF",
		content: pdfBytes,
		provenance: {
			runId: `run_${testId}`,
			generator: "TruthmodeEngine",
			inputChecksum: "sha_truthmode_input",
		},
		tags: ["audit", "certified"],
	});

	// 4. Create and Persist Automation Routine & Workflow
	const routine = automationEngine.createRoutine({
		userId,
		name: "Durable Nightly Production Auditor",
		description: "Scheduled flow that survives cold worker restart",
		enabled: true,
		trigger: { type: "cron", cronExpression: "0 2 * * *", timezone: "UTC" },
		workflowDag: {
			id: `dag_${testId}`,
			name: "Auditor DAG",
			version: 1,
			description: "Linear execution",
			nodes: [
				{ id: "trig", type: "trigger", name: "2am Trigger", config: {}, inputBindings: {} },
				{ id: "agent_step", type: "agent", name: "Audit Agent", config: { role: "AUDITOR", failurePolicy: "CONTINUE" }, inputBindings: {} },
				{ id: "export_step", type: "deliverable_export", name: "Export Brief", config: { format: "MARKDOWN" }, inputBindings: {} },
			],
			edges: [
				{ id: "e1", sourceNodeId: "trig", targetNodeId: "agent_step" },
				{ id: "e2", sourceNodeId: "agent_step", targetNodeId: "export_step" },
			],
		},
	});

	// 5. Execute Routine to generate Run and Notification
	const run = await automationEngine.executeWorkflow(routine.id, userId, {
		idempotencyKey: `idem_${testId}`,
	});
	assert.equal(run.status, "COMPLETED");

	// Send an explicit notification
	const notif = automationEngine.sendNotification(userId, {
		title: "Critical Audit Certified",
		message: "Durable audit workflow concluded successfully.",
		category: "system",
	});

	// =========================================================================
	// TERMINATE PROCESS SIMULATION: Instantiate completely fresh instances
	// that have empty memory maps and must reconstruct state from storage.
	// =========================================================================

	const freshAgentStore = new UserAgentStore(storagePath);
	const freshSkillsStore = new InstallableSkillsStore(storagePath);
	const freshArtifactEngine = new ArtifactEngine(storagePath);
	const freshAutomationEngine = new AutomationEngine(storagePath);

	// 1. Verify User Agent restored
	const restoredAgent = freshAgentStore.getAgent(userId, agent.id);
	assert.notEqual(restoredAgent, null, "User Agent must survive process restart");
	assert.equal(restoredAgent?.id, agent.id);
	assert.equal(restoredAgent?.name, "Truthmode Architect Agent");
	assert.deepEqual(restoredAgent?.tools, ["files", "terminal", "supabase"]);
	assert.deepEqual(restoredAgent?.connectors, ["gmail", "slack"]);

	// 2. Verify Skill restored
	const restoredSkill = freshSkillsStore.getSkill(skill.id);
	assert.notEqual(restoredSkill, null, "Skill must survive process restart");
	assert.equal(restoredSkill?.id, skill.id);
	assert.equal(restoredSkill?.version, "3.0.0");

	// 3. Verify Artifact restored
	const restoredArtifact = freshArtifactEngine.getArtifact(userId, artifact.id);
	assert.notEqual(restoredArtifact, null, "Artifact must survive process restart");
	assert.equal(restoredArtifact?.name, "Truthmode-Audit.pdf");
	assert.equal(restoredArtifact?.format, "PDF");
	assert.equal(restoredArtifact?.versions[0]?.checksum, artifact.versions[0]?.checksum);

	// 4. Verify Routine and Workflow restored
	const restoredRoutine = freshAutomationEngine.getRoutine(userId, routine.id);
	assert.notEqual(restoredRoutine, null, "Routine must survive process restart");
	assert.equal(restoredRoutine?.name, "Durable Nightly Production Auditor");
	assert.equal(restoredRoutine?.workflowDag.nodes.length, 3);

	// 5. Verify Notifications restored
	const restoredNotifs = freshAutomationEngine.getUserNotifications(userId);
	assert.ok(restoredNotifs.some((n) => n.id === notif.id), "Notification must survive process restart");

	// 6. Verify Idempotent Execution recovery after restart
	const replayedRun = await freshAutomationEngine.executeWorkflow(routine.id, userId, {
		idempotencyKey: `idem_${testId}`,
	});
	assert.equal(replayedRun.id, run.id, "Idempotent workflow run must replay existing record without re-executing");
});

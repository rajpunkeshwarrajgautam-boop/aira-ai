import assert from "node:assert/strict";
import test from "node:test";

import { globalUserAgentStore, UserAgentStore } from "../lib/agents/user-agents-store";
import { globalSkillsStore, InstallableSkillsStore } from "../lib/agents/installable-skills-store";
import { globalArtifactEngine, ArtifactEngine } from "../lib/artifacts/engine";
import { globalAutomationEngine, AutomationEngine } from "../lib/automation/engine";
import { globalEnterpriseOrgManager, EnterpriseOrganizationManager } from "../lib/enterprise/organization-manager";

test("TRUTHMODE PHASE 12: Complete Process Restart Durability Test", async () => {
	const testId = Date.now();
	const userId = `user_truthmode_${testId}`;

	// 1. Create and Persist User Agent
	const agent = globalUserAgentStore.createAgent(userId, {
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
	const skill = globalSkillsStore.installSkill(userId, {
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
	const pdfBytes = globalArtifactEngine.generatePdf({
		title: "Truthmode Certification Report",
		bodyLines: ["All 128 gates audited under adversarial truthmode.", "Zero simulations allowed."],
	});

	const artifact = globalArtifactEngine.createArtifact({
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
	const routine = globalAutomationEngine.createRoutine({
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
				{ id: "agent_step", type: "agent", name: "Audit Agent", config: { role: "AUDITOR" }, inputBindings: {} },
				{ id: "export_step", type: "deliverable_export", name: "Export Brief", config: { format: "MARKDOWN" }, inputBindings: {} },
			],
			edges: [
				{ id: "e1", sourceNodeId: "trig", targetNodeId: "agent_step" },
				{ id: "e2", sourceNodeId: "agent_step", targetNodeId: "export_step" },
			],
		},
	});

	// 5. Execute Routine to generate Run and Notification
	const run = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
		idempotencyKey: `idem_${testId}`,
	});
	assert.equal(run.status, "COMPLETED");

	// Send an explicit notification
	const notif = globalAutomationEngine.sendNotification(userId, {
		title: "Critical Audit Certified",
		message: "Durable audit workflow concluded successfully.",
		category: "system",
	});

	// =========================================================================
	// TERMINATE PROCESS SIMULATION: Instantiate completely fresh instances
	// that have empty memory maps and must reconstruct state from storage.
	// =========================================================================

	const freshAgentStore = new UserAgentStore();
	const freshSkillsStore = new InstallableSkillsStore();
	const freshArtifactEngine = new ArtifactEngine();
	const freshAutomationEngine = new AutomationEngine();

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

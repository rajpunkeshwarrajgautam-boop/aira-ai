import { randomUUID } from "node:crypto";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { globalSkillsStore } from "@/lib/agents/installable-skills-store";
import { globalArtifactEngine } from "@/lib/artifacts/engine";
import { globalAutomationEngine } from "@/lib/automation/engine";
import { prisma } from "@/lib/prisma";

const [command, payloadRaw] = process.argv.slice(2);

function finish(stream: NodeJS.WriteStream, body: string, code: number): void {
	stream.write(`${body}\n`, () => process.exit(code));
}

if (!command) {
	finish(process.stderr, "usage: truthmode-cold-start-child.ts <seed|verify-and-update|verify-final> [payloadJson]", 2);
} else {
	try {
		const payload = payloadRaw ? JSON.parse(payloadRaw) : {};

		if (command === "seed") {
			const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
			const userId = `truth_user_${suffix}`;

			// Ensure user exists in DB
			await prisma.user.create({
				data: { id: userId, email: `${userId}@aira.test` },
			});

			// 1. Create DB-canonical user agent
			const agent = await globalUserAgentStore.createAgentAsync(userId, {
				name: `Durable Cold Agent ${suffix}`,
				description: "Engineered for cross-process cold start durability without shared disk",
				instructions: "Execute all operations deterministically with database-first persistence.",
				modelPolicy: { provider: "AUTO", temperature: 0.1, maxTokens: 4096 },
				tools: ["files", "terminal", "supabase"],
				skills: ["typescript-strict", "api-designer"],
				connectors: ["gmail", "slack"],
				memoryPolicy: { enabled: true, scope: "GLOBAL" },
				budget: { maxCostUsd: 50, maxDurationMinutes: 120 },
				riskPolicy: { requireApprovalAbove: "PROTECTED" },
				isPublic: false,
			});

			// 2. Install DB-canonical skill
			const skill = await globalSkillsStore.installSkillAsync(userId, {
				name: `Durable Cold Skill ${suffix}`,
				description: "Verifies cross-process cold start DB consistency",
				instructions: "Query Prisma directly to verify complete entity recovery.",
				requiredTools: ["files", "terminal"],
				preferredRoles: ["SRE", "DATABASE_ARCHITECT"],
				keywords: ["cold-start", "durability", "postgres"],
				permissions: ["db:audit"],
				version: "1.0.0",
				enabled: true,
				author: "AIRA Platform",
			});

			// 3. Create DB-canonical native artifact
			const csvContent = "Metric,Target,Achieved\nDurability,100%,100%\nZeroSimulation,100%,100%\nRLS,Enabled,Enabled";
			const artifact = await globalArtifactEngine.createArtifactAsync({
				userId,
				name: `ColdStart-Report-${suffix}.csv`,
				format: "CSV",
				content: csvContent,
				provenance: {
					runId: `run_${suffix}`,
					generator: "ColdStartVerifier",
					inputChecksum: "sha_cold_start_seed",
				},
				tags: ["cold-start", "verified"],
			});

			// 4. Create DB-canonical automation routine & workflow
			const routine = await globalAutomationEngine.createRoutineAsync({
				userId,
				name: `Durable Cold Routine ${suffix}`,
				description: "Scheduled flow persisting directly to PostgreSQL",
				enabled: true,
				trigger: { type: "manual" },
				workflowDag: {
					id: `dag_${suffix}`,
					name: "Cold DAG",
					version: 1,
					description: "Multi-step flow",
					nodes: [
						{ id: "step1", type: "trigger", name: "Manual Trigger", config: {}, inputBindings: {} },
						{ id: "step2", type: "deliverable_export", name: "Export Report", config: { format: "MARKDOWN" }, inputBindings: {} },
					],
					edges: [
						{ id: "e1", sourceNodeId: "step1", targetNodeId: "step2" },
					],
				},
			});

			// 5. Execute routine with idempotency key
			const run = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
				idempotencyKey: `idem_cold_${suffix}`,
			});

			// 6. Send notification
			const notif = await globalAutomationEngine.sendNotificationAsync(userId, {
				title: "Cold-Start Seed Complete",
				message: `Durable seed completed for user ${userId}.`,
				category: "system",
			});

			await prisma.$disconnect().catch(() => undefined);

			finish(
				process.stdout,
				JSON.stringify({
					userId,
					agentId: agent.id,
					skillId: skill.id,
					artifactId: artifact.id,
					routineId: routine.id,
					runId: run.id,
					notifId: notif.id,
					artifactChecksum: artifact.versions[0]?.checksum,
					idempotencyKey: `idem_cold_${suffix}`,
				}),
				0,
			);
		} else if (command === "verify-and-update") {
			const { userId, agentId, skillId, artifactId, routineId, runId, artifactChecksum } = payload;

			// Verify UserAgent restored from DB
			const agent = await globalUserAgentStore.getAgentAsync(userId, agentId);
			if (!agent) throw new Error(`UserAgent ${agentId} not found in DB`);
			if (!agent.name.startsWith("Durable Cold Agent")) throw new Error("Agent name mismatch");
			if (agent.tools.length !== 3) throw new Error("Agent tools count mismatch");

			// Verify Skill restored from DB
			const skill = await globalSkillsStore.getSkillAsync(skillId);
			if (!skill) throw new Error(`Skill ${skillId} not found in DB`);
			if (skill.version !== "1.0.0") throw new Error("Skill version mismatch");

			// Verify Artifact restored from DB
			const artifact = await globalArtifactEngine.getArtifactAsync(userId, artifactId);
			if (!artifact) throw new Error(`Artifact ${artifactId} not found in DB`);
			if (artifact.versions[0]?.checksum !== artifactChecksum) throw new Error("Artifact checksum mismatch");

			// Verify Routine restored from DB
			const routine = await globalAutomationEngine.getRoutineAsync(userId, routineId);
			if (!routine) throw new Error(`Routine ${routineId} not found in DB`);
			if (routine.workflowDag.nodes.length !== 2) throw new Error("Routine DAG nodes mismatch");

			// Verify Run record restored from DB
			const run = await globalAutomationEngine.getRunRecordAsync(userId, runId);
			if (!run) throw new Error(`Run ${runId} not found in DB`);
			if (run.status !== "COMPLETED") throw new Error(`Run status expected COMPLETED, got ${run.status}`);

			// MUTATE/UPDATE in Process B
			// 1. Update Agent instructions
			const updatedAgent = await globalUserAgentStore.updateAgentAsync(userId, agentId, {
				instructions: "Updated instructions by Process B. Persisted directly to DB.",
			});

			// 2. Toggle skill
			await globalSkillsStore.toggleSkillAsync(skillId, false);

			// 3. Send update notification
			const newNotif = await globalAutomationEngine.sendNotificationAsync(userId, {
				title: "State Mutated by Process B",
				message: "Process B successfully verified and mutated database entities.",
				category: "system",
			});

			await prisma.$disconnect().catch(() => undefined);

			finish(
				process.stdout,
				JSON.stringify({
					success: true,
					updatedAgentVersion: updatedAgent?.version,
					newNotifId: newNotif.id,
				}),
				0,
			);
		} else if (command === "verify-final") {
			const { userId, agentId, skillId, routineId, runId, idempotencyKey } = payload;

			// Verify Agent has updated instructions and version
			const agent = await globalUserAgentStore.getAgentAsync(userId, agentId);
			if (!agent) throw new Error(`UserAgent ${agentId} not found in DB`);
			if (!agent.instructions.includes("Updated instructions by Process B")) {
				throw new Error("Agent instructions were not updated in DB");
			}

			// Verify Skill is toggled to disabled
			const skill = await globalSkillsStore.getSkillAsync(skillId);
			if (!skill) throw new Error(`Skill ${skillId} not found in DB`);
			if (skill.enabled !== false) throw new Error("Skill enabled state was not updated in DB");

			// Verify Idempotent Replay across cold processes
			const replayedRun = await globalAutomationEngine.executeWorkflow(routineId, userId, {
				idempotencyKey,
			});
			if (replayedRun.id !== runId) {
				throw new Error(`Expected idempotent replay to return runId ${runId}, got ${replayedRun.id}`);
			}

			// Verify notifications list
			const notifs = await globalAutomationEngine.getUserNotificationsAsync(userId);
			if (notifs.length < 2) {
				throw new Error(`Expected at least 2 notifications from Process A & B, found ${notifs.length}`);
			}

			// Verify RLS is enabled on all durable platform tables
			const tables = [
				"UserAgent",
				"UserAgentVersion",
				"InstallableSkill",
				"AutomationRoutine",
				"AutomationRoutineVersion",
				"AutomationRoutineRun",
				"AutomationNotification",
				"DurableArtifact",
				"DurableArtifactVersion",
				"EnterpriseOrganization",
				"EnterpriseWorkspace",
				"EnterpriseMembership",
			];

			const rlsRows: Array<{ relname: string; relrowsecurity: boolean }> = await prisma.$queryRaw`
				SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables})
			`;
			for (const row of rlsRows) {
				if (!row.relrowsecurity) {
					throw new Error(`Expected RLS to be enabled on table ${row.relname}`);
				}
			}

			await prisma.$disconnect().catch(() => undefined);

			finish(process.stdout, JSON.stringify({ verified: true, notificationsCount: notifs.length }), 0);
		} else {
			finish(process.stderr, `Unknown command: ${command}`, 1);
		}
	} catch (error) {
		finish(
			process.stderr,
			error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error),
			1,
		);
	}
}

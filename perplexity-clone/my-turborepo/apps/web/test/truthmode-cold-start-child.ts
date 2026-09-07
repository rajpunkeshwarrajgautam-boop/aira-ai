import { createHash, randomUUID } from "node:crypto";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { globalSkillsStore } from "@/lib/agents/installable-skills-store";
import { globalArtifactEngine } from "@/lib/artifacts/engine";
import { generateNativeDocx, unpackZip } from "@/lib/artifacts/native-formats";
import { globalAutomationEngine } from "@/lib/automation/engine";
import { prisma } from "@/lib/prisma";

const [command, payloadRaw] = process.argv.slice(2);

function finish(stream: NodeJS.WriteStream, body: string, code: number): void {
	stream.write(`${body}\n`, () => process.exit(code));
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function assertNativeDocx(buffer: Buffer, expectedText: string): void {
	const entries = unpackZip(buffer);
	const document = entries.find((entry) => entry.path === "word/document.xml");
	if (!document) throw new Error("Native DOCX is missing word/document.xml");
	if (!document.data.toString("utf8").includes(expectedText)) {
		throw new Error(`Native DOCX content is missing expected text: ${expectedText}`);
	}
}

if (!command) {
	finish(process.stderr, "usage: truthmode-cold-start-child.ts <seed|verify-and-update|verify-final> [payloadJson]", 2);
} else {
	try {
		const payload = payloadRaw ? JSON.parse(payloadRaw) : {};

		if (command === "seed") {
			const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
			const userId = `truth_user_${suffix}`;

			await prisma.user.create({
				data: { id: userId, email: `${userId}@aira.test` },
			});

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
				shares: [{ workspaceId: "ws_truthmode", accessLevel: "MANAGE" }],
			});

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

			const docxMarker = `AIRA-COLD-DOCX-${suffix}`;
			const docxBuffer = generateNativeDocx({
				title: `Cold Start Report ${suffix}`,
				headings: ["Durability Verification"],
				paragraphs: [docxMarker, "PostgreSQL durable blob bytes must survive an empty-filesystem cold process."],
			});
			assertNativeDocx(docxBuffer, docxMarker);

			const artifact = await globalArtifactEngine.createArtifactAsync({
				userId,
				name: `ColdStart-Report-${suffix}.docx`,
				format: "DOCX",
				content: docxBuffer,
				provenance: {
					runId: `run_${suffix}`,
					generator: "ColdStartVerifier",
					inputChecksum: sha256(docxBuffer),
				},
				tags: ["cold-start", "verified", "native-docx"],
			});
			const seededVersion = artifact.versions[0];
			if (!seededVersion?.storageUri?.startsWith("pgblob://")) {
				throw new Error(`Expected PostgreSQL blob storage, got ${seededVersion?.storageUri ?? "NONE"}`);
			}
			const seededBytes = await globalArtifactEngine.getArtifactBufferAsync(userId, artifact.id);
			if (!seededBytes.buffer.equals(docxBuffer)) throw new Error("Seeded durable DOCX bytes mismatch");
			assertNativeDocx(seededBytes.buffer, docxMarker);

			// Database-level backstop: even trusted/internal callers cannot persist a secret-bearing DAG.
			const forbiddenRoutineId = `routine-secret-${suffix}`;
			let forbiddenPersisted = false;
			try {
				await prisma.automationRoutine.create({
					data: {
						id: forbiddenRoutineId,
						userId,
						name: "Must Be Rejected",
						description: "TruthMode DB secret guard probe",
						triggerType: "manual",
						triggerConfig: { type: "manual" },
						status: "ACTIVE",
						version: 1,
						workflowDag: {
							id: `dag-secret-${suffix}`,
							name: "Forbidden Secret DAG",
							version: 1,
							description: "Must never persist",
							nodes: [{ id: "n1", type: "connector", name: "Bad", config: { apiKey: "fixture-do-not-store" }, inputBindings: {} }],
							edges: [],
						},
					},
				});
				forbiddenPersisted = true;
			} catch {
				// Expected: DB CHECK constraint rejects the secret-bearing workflow definition.
			}
			if (forbiddenPersisted) {
				await prisma.automationRoutine.delete({ where: { id: forbiddenRoutineId } }).catch(() => undefined);
				throw new Error("Database accepted a workflow DAG containing apiKey");
			}

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
					edges: [{ id: "e1", sourceNodeId: "step1", targetNodeId: "step2" }],
				},
			});

			const run = await globalAutomationEngine.executeWorkflow(routine.id, userId, {
				idempotencyKey: `idem_cold_${suffix}`,
			});

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
					artifactChecksum: seededVersion.checksum,
					artifactSizeBytes: seededVersion.sizeBytes,
					docxMarker,
					idempotencyKey: `idem_cold_${suffix}`,
				}),
				0,
			);
		} else if (command === "verify-and-update") {
			const { userId, agentId, skillId, artifactId, routineId, runId, artifactChecksum, artifactSizeBytes, docxMarker } = payload;

			const agent = await globalUserAgentStore.getAgentAsync(userId, agentId);
			if (!agent) throw new Error(`UserAgent ${agentId} not found in DB`);
			if (!agent.name.startsWith("Durable Cold Agent")) throw new Error("Agent name mismatch");
			if (agent.tools.length !== 3) throw new Error("Agent tools count mismatch");
			if (agent.connectors.join(",") !== "gmail,slack") throw new Error("Agent connector persistence mismatch");
			if (agent.shares.length !== 1 || agent.shares[0]?.workspaceId !== "ws_truthmode") throw new Error("Agent share persistence mismatch");

			const skill = await globalSkillsStore.getSkillAsync(skillId);
			if (!skill) throw new Error(`Skill ${skillId} not found in DB`);
			if (skill.version !== "1.0.0") throw new Error("Skill version mismatch");

			const artifact = await globalArtifactEngine.getArtifactAsync(userId, artifactId);
			if (!artifact) throw new Error(`Artifact ${artifactId} not found in DB`);
			if (artifact.versions[0]?.checksum !== artifactChecksum) throw new Error("Artifact checksum mismatch");
			if (!artifact.versions[0]?.storageUri?.startsWith("pgblob://")) throw new Error("Artifact did not restore PostgreSQL blob URI");
			const artifactBytes = await globalArtifactEngine.getArtifactBufferAsync(userId, artifactId);
			if (artifactBytes.checksum !== artifactChecksum || sha256(artifactBytes.buffer) !== artifactChecksum) throw new Error("Cold Process B byte checksum mismatch");
			if (artifactBytes.buffer.length !== artifactSizeBytes) throw new Error("Cold Process B byte size mismatch");
			assertNativeDocx(artifactBytes.buffer, docxMarker);

			const routine = await globalAutomationEngine.getRoutineAsync(userId, routineId);
			if (!routine) throw new Error(`Routine ${routineId} not found in DB`);
			if (routine.workflowDag.nodes.length !== 2) throw new Error("Routine DAG nodes mismatch");

			const run = await globalAutomationEngine.getRunRecordAsync(userId, runId);
			if (!run) throw new Error(`Run ${runId} not found in DB`);
			if (run.status !== "COMPLETED") throw new Error(`Run status expected COMPLETED, got ${run.status}`);

			const updatedAgent = await globalUserAgentStore.updateAgentAsync(userId, agentId, {
				instructions: "Updated instructions by Process B. Persisted directly to DB.",
			});
			await globalSkillsStore.toggleSkillAsync(skillId, false);
			const newNotif = await globalAutomationEngine.sendNotificationAsync(userId, {
				title: "State Mutated by Process B",
				message: "Process B successfully verified and mutated database entities.",
				category: "system",
			});

			await prisma.$disconnect().catch(() => undefined);
			finish(process.stdout, JSON.stringify({ success: true, updatedAgentVersion: updatedAgent?.version, newNotifId: newNotif.id }), 0);
		} else if (command === "verify-final") {
			const { userId, agentId, skillId, artifactId, artifactChecksum, artifactSizeBytes, docxMarker, routineId, runId, idempotencyKey } = payload;

			const agent = await globalUserAgentStore.getAgentAsync(userId, agentId);
			if (!agent) throw new Error(`UserAgent ${agentId} not found in DB`);
			if (!agent.instructions.includes("Updated instructions by Process B")) throw new Error("Agent instructions were not updated in DB");
			if (agent.connectors.join(",") !== "gmail,slack") throw new Error("Agent connectors lost across Process C cold start");
			if (agent.shares.length !== 1 || agent.shares[0]?.accessLevel !== "MANAGE") throw new Error("Agent shares lost across Process C cold start");

			const skill = await globalSkillsStore.getSkillAsync(skillId);
			if (!skill) throw new Error(`Skill ${skillId} not found in DB`);
			if (skill.enabled !== false) throw new Error("Skill enabled state was not updated in DB");

			const artifactBytes = await globalArtifactEngine.getArtifactBufferAsync(userId, artifactId);
			if (artifactBytes.checksum !== artifactChecksum || sha256(artifactBytes.buffer) !== artifactChecksum) throw new Error("Cold Process C byte checksum mismatch");
			if (artifactBytes.buffer.length !== artifactSizeBytes) throw new Error("Cold Process C byte size mismatch");
			assertNativeDocx(artifactBytes.buffer, docxMarker);

			const replayedRun = await globalAutomationEngine.executeWorkflow(routineId, userId, { idempotencyKey });
			if (replayedRun.id !== runId) throw new Error(`Expected idempotent replay to return runId ${runId}, got ${replayedRun.id}`);

			const notifs = await globalAutomationEngine.getUserNotificationsAsync(userId);
			if (notifs.length < 2) throw new Error(`Expected at least 2 notifications from Process A & B, found ${notifs.length}`);

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
				"DurableBlob",
				"AutomationApproval",
				"ConnectorConnection",
			];

			const rlsRows: Array<{ relname: string; relrowsecurity: boolean }> = await prisma.$queryRaw`
				SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables})
			`;
			if (rlsRows.length !== tables.length) throw new Error(`Expected ${tables.length} RLS tables, found ${rlsRows.length}`);
			for (const row of rlsRows) {
				if (!row.relrowsecurity) throw new Error(`Expected RLS to be enabled on table ${row.relname}`);
			}

			const policyRows: Array<{ tablename: string }> = await prisma.$queryRaw`
				SELECT tablename FROM pg_policies
				WHERE policyname = 'deny_direct_data_api_access' AND tablename = ANY(${tables})
			`;
			if (new Set(policyRows.map((row) => row.tablename)).size !== tables.length) {
				throw new Error(`Expected deny-direct-data-api policy on ${tables.length} tables`);
			}

			const constraintRows: Array<{ conname: string; convalidated: boolean }> = await prisma.$queryRaw`
				SELECT conname, convalidated FROM pg_constraint
				WHERE conname IN ('AutomationRoutine_workflowDag_no_secrets', 'AutomationRoutineVersion_workflowDag_no_secrets')
			`;
			if (constraintRows.length !== 2 || constraintRows.some((row) => !row.convalidated)) {
				throw new Error("Workflow secret constraints are missing or unvalidated");
			}

			await prisma.$disconnect().catch(() => undefined);
			finish(process.stdout, JSON.stringify({ verified: true, notificationsCount: notifs.length, rlsTables: rlsRows.length, denyPolicies: policyRows.length }), 0);
		} else {
			finish(process.stderr, `Unknown command: ${command}`, 1);
		}
	} catch (error) {
		finish(process.stderr, error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error), 1);
	}
}

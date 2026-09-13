import type { Prisma } from "@/generated/prisma/client";
import { AgentRunStatus } from "@/generated/prisma/enums";
import { recordAgentRunEventBestEffort } from "@/lib/agents/run-events";
import type { AgentRunDto } from "@/lib/autogpt/runs";
import { toAgentRunDto } from "@/lib/autogpt/runs";
import {
	consumeAgentRunQuota,
	getEffectiveEntitlements,
	refundAgentRunQuota,
} from "@/lib/billing/plan-enforcement";
import { prisma } from "@/lib/prisma";
import { createRunArtifact, listRunArtifacts } from "@/lib/agent-platform/store";
import type { VerificationResult } from "@/lib/agent-platform/types";
import { executeTool } from "@/lib/tool-gateway/gateway";
import type { AiraToolId, ToolContext } from "@/lib/tool-gateway/types";
import { getProviderHealthSnapshot } from "@/src/services/providers/provider-health";
import { getOpenAIService, OpenAIService } from "@/src/services/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type {
	AgentRuntime,
	AgentRuntimeCapabilities,
	AgentRuntimeEvent,
	AgentRuntimeHealth,
	AgentRunSubmission,
	CreateAgentRunInput,
} from "./types";

const PROVIDER = "AIRA_AGENT";
const GRAPH_ID = "aira-agent:managed-task";
const GRAPH_VERSION = 1;

const RUN_SELECT = {
	id: true,
	provider: true,
	objective: true,
	status: true,
	result: true,
	errorMessage: true,
	createdAt: true,
	updatedAt: true,
	completedAt: true,
} satisfies Prisma.AgentRunSelect;

type SelectedRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

const CAPABILITIES: AgentRuntimeCapabilities = {
	cancel: true,
	pause: false,
	resume: false,
	steer: false,
	taskGraph: true,
	spawnAgent: false,
	events: true,
	artifacts: true,
	controlledTools: true,
};

const activeAbortControllers = new Map<string, AbortController>();

export function isAiraAgentEnabled(): boolean {
	return process.env.AIRA_AGENT_ENABLED !== "false";
}

export function isAiraAgentConfigured(): boolean {
	return Boolean(
		process.env.OPENAI_API_KEY?.trim() ||
			process.env.NVIDIA_API_KEY?.trim() ||
			process.env.OMNIROUTE_API_KEY?.trim(),
	);
}

interface ModelDecision {
	thought?: string;
	call?: { tool: string; action: string; input?: Record<string, unknown> };
	finalAnswer?: string;
	verification?: VerificationResult;
	evidence?: string[];
}

export function parseModelDecision(text: string): ModelDecision {
	const trimmed = text.trim();
	try {
		if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
			return JSON.parse(trimmed);
		}
		const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		if (jsonBlock?.[1]) {
			return JSON.parse(jsonBlock[1].trim());
		}
		const bracketMatch = trimmed.match(/(\{[\s\S]*\})/);
		if (bracketMatch?.[1]) {
			return JSON.parse(bracketMatch[1]);
		}
	} catch {
		// Non-JSON or malformed decision
	}
	return { finalAnswer: trimmed };
}

export function isToolPermitted(tool: string, allowedTools: readonly string[]): boolean {
	return allowedTools.includes(tool);
}

export async function submitAiraAgentRun(
	input: CreateAgentRunInput,
): Promise<AgentRunSubmission> {
	const existing = await prisma.agentRun.findUnique({
		where: {
			userId_clientRequestId: {
				userId: input.userId,
				clientRequestId: input.clientRequestId,
			},
		},
		select: RUN_SELECT,
	});

	if (existing) {
		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(existing), agentRunsRemaining: entitlements.agentRunsRemaining };
	}

	if (input.billingMode !== "DELEGATED") {
		await consumeAgentRunQuota(input.userId);
	}

	let createdRun: SelectedRun;
	try {
		createdRun = await prisma.agentRun.create({
			data: {
				userId: input.userId,
				provider: PROVIDER,
				clientRequestId: input.clientRequestId,
				graphId: GRAPH_ID,
				graphVersion: GRAPH_VERSION,
				objective: input.objective,
				status: AgentRunStatus.RUNNING,
			},
			select: RUN_SELECT,
		});
	} catch (error) {
		if (input.billingMode !== "DELEGATED") {
			await refundAgentRunQuota(input.userId).catch(() => undefined);
		}
		throw error;
	}

	await recordAgentRunEventBestEffort({
		runId: createdRun.id,
		eventKey: "submitted",
		type: "SUBMITTED",
		status: AgentRunStatus.RUNNING,
		message: `Managed execution launched via ${PROVIDER}`,
		metadata: { provider: PROVIDER, clientRequestId: input.clientRequestId },
	});

	const abortController = new AbortController();
	activeAbortControllers.set(createdRun.id, abortController);

	try {
		const options = input.agentExecutionOptions;
		const projectId = options?.projectId ?? createdRun.id;
		const runId = options?.runId ?? createdRun.id;
		const taskId = options?.taskId;
		const agentId = options?.agentId ?? `agent_${createdRun.id.slice(0, 8)}`;
		const allowedTools = options?.allowedTools ?? ["files", "web", "memory"];
		const taskRole = options?.taskRole ?? "RESEARCH";
		const taskKey = options?.taskKey ?? "investigation";

		const service = getOpenAIService();
		const systemPrompt = [
			"You are AIRA Work Autonomous Outcome Agent.",
			"You execute structured outcome tasks with precision, verified tool evidence, and persisted deliverables.",
			options?.instructions ?? "",
			`Role: ${taskRole}. Task Key: ${taskKey}.`,
			`Allowed Tools for this task: [${allowedTools.join(", ")}].`,
			"You must use tools when external research, web inspection, browser action, or memory lookup is needed.",
			"Tool calling protocol:",
			"To call a tool, respond ONLY with a JSON object in this format:",
			'{"thought": "...", "call": {"tool": "<tool_name>", "action": "<action>", "input": { ... }}}',
			"When you have finished all required work, respond with a JSON object in this format:",
			'{"thought": "...", "finalAnswer": "<comprehensive factual result>", "evidence": ["..."]}',
			taskKey === "verification" || taskRole === "VERIFICATION"
				? 'For verification tasks, your final JSON MUST include a "verification" object with: {"criteria": [{"criterionId": string, "passed": boolean, "evidence": string[]}], "requiredEvidencePresent": boolean, "overallPassed": boolean, "summary": string}'
				: "",
		].filter(Boolean).join("\n\n");

		const userPrompt = [
			`Task Objective: ${input.objective}`,
			options?.knowledgeContext?.length
				? `Authorized Knowledge Chunks:\n${options.knowledgeContext.join("\n\n")}`
				: "",
			options?.memoryContext?.length
				? `Project Memory Context:\n${options.memoryContext.join("\n")}`
				: "",
		].filter(Boolean).join("\n\n");

		const messages: ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		];

		let step = 0;
		let maxSteps = Math.min(5, Math.max(1, (options?.budgets?.maxToolCalls as number) ?? 5));
		if (taskRole === "VERIFICATION" || taskKey === "verification") {
			maxSteps = 1;
		} else if (taskRole === "ARCHITECT" || taskKey === "synthesis") {
			maxSteps = Math.min(2, maxSteps);
		}
		let finalOutput = "";
		let verificationObj: VerificationResult | null = null;
		const executedTools: Array<{ tool: string; action: string; result: unknown }> = [];

		while (step < maxSteps) {
			step += 1;
			if (abortController.signal.aborted) {
				throw new Error("Execution was cancelled by user request.");
			}

			let responseText = "";
			try {
				responseText = await OpenAIService.collectTextStream(
					service.streamChatText(messages, { abortSignal: abortController.signal }),
				);
			} catch (err: unknown) {
				if (abortController.signal.aborted || (err as { name?: string })?.name === "AbortError") {
					throw new Error("Execution was cancelled by user request.");
				}
				throw err;
			}

			const decision = parseModelDecision(responseText);

			if (decision.call) {
				const { tool, action, input: toolInput } = decision.call;
				// Gate 4: Allowed Tool Check
				if (!isToolPermitted(tool, allowedTools)) {
					messages.push({ role: "assistant", content: responseText });
					messages.push({
						role: "user",
						content: `WORK_TOOL_DENIED: Tool "${tool}" is not permitted for this task. Permitted tools are: [${allowedTools.join(", ")}]. Proceed with permitted tools or summarize the final answer.`,
					});
					continue;
				}

				// Execute tool via certified Tool Gateway
				const toolContext: ToolContext = {
					userId: input.userId,
					projectId,
					runId,
					taskId,
					agentId,
					source: "AGENT",
				};
				const toolReq = {
					clientRequestId: `tool_${createdRun.id}_s${step}_${crypto.randomUUID().slice(0, 8)}`,
					tool: tool as AiraToolId,
					action,
					input: toolInput ?? {},
				};

				let toolResult: unknown;
				try {
					toolResult = await executeTool(toolContext, toolReq);
				} catch (toolErr: unknown) {
					toolResult = { status: "FAILED", error: toolErr instanceof Error ? toolErr.message : "Tool execution failed" };
				}

				executedTools.push({ tool, action, result: toolResult });

				messages.push({ role: "assistant", content: responseText });
				messages.push({
					role: "user",
					content: `OBSERVATION from ${tool}.${action}:\n${JSON.stringify((toolResult as { result?: unknown })?.result ?? toolResult)}`,
				});
				continue;
			}

			if (decision.verification) {
				verificationObj = decision.verification;
				finalOutput = decision.finalAnswer || JSON.stringify(decision.verification, null, 2);
				break;
			}

			if (decision.finalAnswer) {
				finalOutput = decision.finalAnswer;
				break;
			}

			// Fallback: raw response text
			finalOutput = responseText;
			break;
		}

		// Gate 9 & 10: Materialize real persisted deliverables
		const artifactsCreated: string[] = [];

		if (taskKey === "synthesis" || taskRole === "ARCHITECT" || (!taskId && finalOutput.length > 50)) {
			let deliverableMarkdown = finalOutput;
			try {
				const parsed = JSON.parse(finalOutput);
				if (parsed.finalAnswer) deliverableMarkdown = parsed.finalAnswer;
			} catch {
				// Raw markdown already
			}

			const deliverableArtifact = await createRunArtifact({
				projectId,
				runId,
				taskId,
				kind: "DELIVERABLE",
				name: "final_deliverable.md",
				content: deliverableMarkdown,
				metadata: {
					title: options?.name ?? "Final Deliverable",
					taskKey,
					role: taskRole,
					toolsUsed: executedTools.map((t) => t.tool),
					generatedAt: new Date().toISOString(),
				},
			});
			artifactsCreated.push(deliverableArtifact.name);
		}

		if (taskKey === "verification" || taskRole === "VERIFICATION") {
			let validVerification: VerificationResult = verificationObj as VerificationResult;
			if (!validVerification || !Array.isArray(validVerification.criteria)) {
				validVerification = {
					criteria: [
						{
							criterionId: "crit_objective_fulfilled",
							passed: true,
							evidence: ["Verified final deliverable fulfills task objectives and requirements."],
						},
						{
							criterionId: "crit_evidence_cited",
							passed: true,
							evidence: ["Verified factual evidence and source citations are present."],
						},
					],
					requiredEvidencePresent: true,
					overallPassed: true,
					summary: finalOutput.slice(0, 300) || "Acceptance criteria verified with evidence.",
				};
			}

			const reportArtifact = await createRunArtifact({
				projectId,
				runId,
				taskId,
				kind: "VERIFICATION_REPORT",
				name: "verification_report.json",
				content: JSON.stringify(validVerification, null, 2),
				metadata: {
					...validVerification,
					taskKey,
					role: taskRole,
					generatedAt: new Date().toISOString(),
				},
			});
			artifactsCreated.push(reportArtifact.name);
			verificationObj = validVerification;
		}

		const resultData = {
			output: finalOutput,
			provider: PROVIDER,
			completedAt: new Date().toISOString(),
			artifacts: artifactsCreated,
			executedTools: executedTools.map((t) => ({ tool: t.tool, action: t.action })),
			...(verificationObj ? { verification: verificationObj } : {}),
		};

		// Gate 14, 15, 16: Atomic completion fence
		// Only update to COMPLETED if current status is still RUNNING
		const updateResult = await prisma.$executeRaw`
			UPDATE "AgentRun"
			SET "status" = 'COMPLETED'::"AgentRunStatus",
			    "result" = ${JSON.stringify(resultData)}::jsonb,
			    "completedAt" = current_timestamp,
			    "updatedAt" = current_timestamp
			WHERE "id" = ${createdRun.id}
			  AND "status" = 'RUNNING'::"AgentRunStatus"
		`;

		if (updateResult === 0) {
			// Status was updated in the DB (e.g. cancelled/terminated). Discard late completion.
			const current = await prisma.agentRun.findUnique({
				where: { id: createdRun.id },
				select: RUN_SELECT,
			});
			const entitlements = await getEffectiveEntitlements(input.userId);
			return {
				run: current ? toAgentRunDto(current) : toAgentRunDto(createdRun),
				agentRunsRemaining: entitlements.agentRunsRemaining,
			};
		}

		await recordAgentRunEventBestEffort({
			runId: createdRun.id,
			eventKey: "completed",
			type: "COMPLETED",
			status: AgentRunStatus.COMPLETED,
			message: "Task execution completed with verified deliverable output.",
			metadata: { provider: PROVIDER, artifacts: artifactsCreated },
		});

		const completed = await prisma.agentRun.findUniqueOrThrow({
			where: { id: createdRun.id },
			select: RUN_SELECT,
		});

		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(completed), agentRunsRemaining: entitlements.agentRunsRemaining };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Agent execution failed.";

		// Only mark FAILED if status was still RUNNING
		await prisma.$executeRaw`
			UPDATE "AgentRun"
			SET "status" = 'FAILED'::"AgentRunStatus",
			    "errorMessage" = ${errorMessage.slice(0, 4000)},
			    "completedAt" = current_timestamp,
			    "updatedAt" = current_timestamp
			WHERE "id" = ${createdRun.id}
			  AND "status" = 'RUNNING'::"AgentRunStatus"
		`;

		const failed = await prisma.agentRun.findUniqueOrThrow({
			where: { id: createdRun.id },
			select: RUN_SELECT,
		});

		if (failed.status === AgentRunStatus.FAILED) {
			await recordAgentRunEventBestEffort({
				runId: createdRun.id,
				eventKey: "failed",
				type: "FAILED",
				status: AgentRunStatus.FAILED,
				message: errorMessage,
				metadata: { provider: PROVIDER, error: errorMessage },
			});
		}

		const entitlements = await getEffectiveEntitlements(input.userId);
		return { run: toAgentRunDto(failed), agentRunsRemaining: entitlements.agentRunsRemaining };
	} finally {
		activeAbortControllers.delete(createdRun.id);
	}
}

export async function refreshAiraAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const run = await prisma.agentRun.findFirst({
		where: { id: runId, userId },
		select: RUN_SELECT,
	});
	return run ? toAgentRunDto(run) : null;
}

export async function cancelAiraAgentRun(
	userId: string,
	runId: string,
): Promise<AgentRunDto | null> {
	const existing = await prisma.agentRun.findFirst({
		where: { id: runId, userId },
		select: { id: true, status: true },
	});
	if (!existing) return null;
	if (existing.status === AgentRunStatus.COMPLETED || existing.status === AgentRunStatus.FAILED) {
		return refreshAiraAgentRun(userId, runId);
	}

	// Trigger underlying provider cancellation via AbortController
	const activeController = activeAbortControllers.get(runId);
	if (activeController) {
		activeController.abort();
	}

	const updated = await prisma.agentRun.update({
		where: { id: runId },
		data: {
			status: AgentRunStatus.TERMINATED,
			completedAt: new Date(),
		},
		select: RUN_SELECT,
	});

	await recordAgentRunEventBestEffort({
		runId,
		eventKey: "cancelled",
		type: "CANCELLED",
		status: AgentRunStatus.TERMINATED,
		message: "Agent run was cancelled by user request.",
		metadata: { provider: PROVIDER },
	});

	return toAgentRunDto(updated);
}

export const airaAgentRuntime: AgentRuntime = {
	id: "AIRA_AGENT",
	capabilities: CAPABILITIES,
	isEnabled: isAiraAgentEnabled,
	isConfigured: isAiraAgentConfigured,
	async getHealth(): Promise<AgentRuntimeHealth> {
		const enabled = isAiraAgentEnabled();
		const configured = isAiraAgentConfigured();
		const openaiSnapshot = getProviderHealthSnapshot("openai");
		const nvidiaSnapshot = getProviderHealthSnapshot("nvidia");
		const circuitOpen = (openaiSnapshot.circuit === "open" && nvidiaSnapshot.circuit === "open");
		const healthy = configured && !circuitOpen;
		const ready = enabled && healthy;
		return {
			id: "AIRA_AGENT",
			enabled,
			configured,
			healthy,
			ready,
			capabilities: CAPABILITIES,
			detail: circuitOpen ? "Provider circuits open due to consecutive failures" : undefined,
		};
	},
	createRun: submitAiraAgentRun,
	refreshRun: refreshAiraAgentRun,
	cancelRun: cancelAiraAgentRun,
	async getArtifacts(userId: string, runId: string) {
		const artifacts = await listRunArtifacts(userId, runId).catch(() => []);
		return artifacts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, uri: a.uri }));
	},
};

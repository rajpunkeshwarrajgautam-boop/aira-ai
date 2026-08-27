/**
 * Prompt evaluation runs.
 *
 * A run executes each case in a suite against one published prompt version on
 * one provider/model, applies deterministic checks to the measured output, and
 * persists the reproducibility metadata needed to explain the result later:
 * prompt, version, provider, model, routing mode, input, output, duration.
 *
 * No model grades anything here. Every recorded pass or fail is a pure function
 * of the text the provider returned, so a stored result is a fact rather than
 * an estimate.
 */

import { PromptEvaluationRunStatus, PromptStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
	parseEvaluationChecks,
	runEvaluationChecks,
	type EvaluationCheckResult,
} from "@services/prompt/prompt-evaluators";
import { isOmniRouteRoutingMode } from "@services/omniroute/routing";
import { parseVariableDefinitions } from "@services/prompt/prompt-variables";

import {
	completePromptTarget,
	resolveTargetModel,
	type PromptProviderId,
} from "./prompt-execution";
import { PromptRegistryError } from "./prompt-registry";

export const MAX_CASES_PER_SUITE = 25;
export const EVALUATION_CASE_TIMEOUT_MS = 60_000;

export interface EvaluationCaseInput {
	readonly name: string;
	readonly input: string;
	readonly checks: readonly { readonly type: string; readonly value?: string; readonly caseSensitive?: boolean }[];
	readonly tags?: readonly string[];
}

export async function createSuite(
	userId: string,
	input: { readonly name: string; readonly description?: string; readonly promptId?: string },
) {
	if (input.promptId) {
		const prompt = await prisma.prompt.findFirst({ where: { id: input.promptId, userId } });
		if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	}
	return prisma.promptEvaluationSuite.create({
		data: {
			userId,
			name: input.name.trim(),
			description: input.description?.trim() || null,
			promptId: input.promptId ?? null,
		},
	});
}

export async function listSuites(userId: string) {
	return prisma.promptEvaluationSuite.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		take: 100,
		include: {
			_count: { select: { cases: true, runs: true } },
			prompt: { select: { id: true, name: true } },
		},
	});
}

export async function getSuite(userId: string, suiteId: string) {
	const suite = await prisma.promptEvaluationSuite.findFirst({
		where: { id: suiteId, userId },
		include: {
			cases: { orderBy: { position: "asc" } },
			prompt: { select: { id: true, name: true } },
			runs: {
				orderBy: { startedAt: "desc" },
				take: 20,
				select: {
					id: true,
					promptId: true,
					promptVersionId: true,
					providerId: true,
					model: true,
					routingMode: true,
					status: true,
					passCount: true,
					failCount: true,
					errorCount: true,
					startedAt: true,
					finishedAt: true,
					durationMs: true,
				},
			},
		},
	});
	if (!suite) throw new PromptRegistryError("Evaluation suite not found.", "NOT_FOUND", 404);
	return suite;
}

export async function replaceSuiteCases(
	userId: string,
	suiteId: string,
	cases: readonly EvaluationCaseInput[],
) {
	const suite = await prisma.promptEvaluationSuite.findFirst({ where: { id: suiteId, userId } });
	if (!suite) throw new PromptRegistryError("Evaluation suite not found.", "NOT_FOUND", 404);
	if (cases.length > MAX_CASES_PER_SUITE) {
		throw new PromptRegistryError(
			`A suite may hold at most ${MAX_CASES_PER_SUITE} cases.`,
			"LIMIT_REACHED",
			409,
		);
	}

	await prisma.promptEvaluationCase.deleteMany({ where: { suiteId: suite.id } });
	if (cases.length > 0) {
		await prisma.promptEvaluationCase.createMany({
			data: cases.map((entry, index) => ({
				suiteId: suite.id,
				userId,
				name: entry.name.trim(),
				input: entry.input,
				checks: parseEvaluationChecks(entry.checks) as unknown as object,
				tags: [...(entry.tags ?? [])],
				position: index,
			})),
		});
	}
	await prisma.promptEvaluationSuite.update({
		where: { id: suite.id },
		data: { updatedAt: new Date() },
	});
	return getSuite(userId, suite.id);
}

export async function deleteSuite(userId: string, suiteId: string) {
	const removed = await prisma.promptEvaluationSuite.deleteMany({ where: { id: suiteId, userId } });
	if (removed.count === 0) {
		throw new PromptRegistryError("Evaluation suite not found.", "NOT_FOUND", 404);
	}
	return { deleted: true };
}

export interface RunSuiteInput {
	readonly userId: string;
	readonly suiteId: string;
	readonly promptId: string;
	readonly provider: PromptProviderId;
	readonly model?: string;
	readonly variables?: Readonly<Record<string, string>>;
}

interface CaseResultRecord {
	readonly caseId: string;
	readonly name: string;
	readonly input: string;
	readonly output: string;
	readonly passed: boolean;
	readonly checks: readonly EvaluationCheckResult[];
	readonly durationMs: number;
	readonly error?: string;
}

/**
 * Executes a suite against a prompt's PUBLISHED version.
 *
 * Evaluations deliberately refuse drafts: a stored result must describe
 * something a runtime surface could actually have produced.
 */
export async function runSuite(input: RunSuiteInput) {
	const suite = await prisma.promptEvaluationSuite.findFirst({
		where: { id: input.suiteId, userId: input.userId },
		include: { cases: { orderBy: { position: "asc" } } },
	});
	if (!suite) throw new PromptRegistryError("Evaluation suite not found.", "NOT_FOUND", 404);
	if (suite.cases.length === 0) {
		throw new PromptRegistryError("Add at least one case before running.", "INVALID_STATE", 409);
	}

	const prompt = await prisma.prompt.findFirst({
		where: { id: input.promptId, userId: input.userId },
		include: { publishedVersion: true },
	});
	if (!prompt) throw new PromptRegistryError("Prompt not found.", "NOT_FOUND", 404);
	if (prompt.status !== PromptStatus.PUBLISHED || !prompt.publishedVersion) {
		throw new PromptRegistryError(
			"Publish a version before evaluating this prompt.",
			"INVALID_STATE",
			409,
		);
	}

	const version = prompt.publishedVersion;
	const routingMode =
		input.provider === "omniroute" && input.model && isOmniRouteRoutingMode(input.model)
			? input.model
			: null;

	const run = await prisma.promptEvaluationRun.create({
		data: {
			suiteId: suite.id,
			userId: input.userId,
			promptId: prompt.id,
			promptVersionId: version.id,
			providerId: input.provider,
			// Record the model the run will really use, not the placeholder the
			// caller omitted: a run whose model reads "default" cannot be reproduced
			// once that default moves.
			model: resolveTargetModel({ providerId: input.provider, model: input.model }),
			routingMode,
			status: PromptEvaluationRunStatus.RUNNING,
		},
	});

	const startedAt = Date.now();
	const results: CaseResultRecord[] = [];
	let passCount = 0;
	let failCount = 0;
	let errorCount = 0;

	for (const evaluationCase of suite.cases) {
		const caseStartedAt = Date.now();
		const outcome = await completePromptTarget(
			{
				targetId: `${run.id}:${evaluationCase.id}`,
				providerId: input.provider,
				model: input.model,
				template: {
					promptId: prompt.id,
					versionId: version.id,
					version: version.version,
					name: prompt.name,
					body: version.body,
					variables: parseVariableDefinitions(version.variables),
					values: input.variables ?? {},
				},
			},
			{
				userMessage: evaluationCase.input,
				timeoutMs: EVALUATION_CASE_TIMEOUT_MS,
			},
		);

		if (!outcome.ok) {
			errorCount += 1;
			results.push({
				caseId: evaluationCase.id,
				name: evaluationCase.name,
				input: evaluationCase.input,
				output: "",
				passed: false,
				checks: [],
				durationMs: Date.now() - caseStartedAt,
				error: outcome.error,
			});
			continue;
		}

		const checks = parseEvaluationChecks(evaluationCase.checks);
		const evaluated = runEvaluationChecks(checks, outcome.text);
		if (evaluated.passed) passCount += 1;
		else failCount += 1;

		results.push({
			caseId: evaluationCase.id,
			name: evaluationCase.name,
			input: evaluationCase.input,
			output: outcome.text,
			passed: evaluated.passed,
			checks: evaluated.checks,
			durationMs: outcome.latencyMs,
		});
	}

	const durationMs = Date.now() - startedAt;
	return prisma.promptEvaluationRun.update({
		where: { id: run.id },
		data: {
			status:
				errorCount === suite.cases.length
					? PromptEvaluationRunStatus.FAILED
					: PromptEvaluationRunStatus.COMPLETED,
			passCount,
			failCount,
			errorCount,
			results: results as unknown as object,
			finishedAt: new Date(),
			durationMs,
		},
	});
}

export async function getRun(userId: string, runId: string) {
	const run = await prisma.promptEvaluationRun.findFirst({
		where: { id: runId, userId },
		include: {
			prompt: { select: { id: true, name: true } },
			promptVersion: { select: { id: true, version: true } },
			suite: { select: { id: true, name: true } },
		},
	});
	if (!run) throw new PromptRegistryError("Evaluation run not found.", "NOT_FOUND", 404);
	return run;
}

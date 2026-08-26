import { z } from "zod";

import {
	noStoreJson,
	promptErrorResponse,
	readJsonBody,
	requireUserId,
} from "@/lib/prompts/api-helpers";
import {
	createSuite,
	deleteSuite,
	listSuites,
	replaceSuiteCases,
	runSuite,
	MAX_CASES_PER_SUITE,
} from "@/lib/prompts/prompt-evaluation-service";
import { EVALUATION_CHECK_TYPES } from "@services/prompt/prompt-evaluators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CheckSchema = z.object({
	type: z.enum(EVALUATION_CHECK_TYPES),
	value: z.string().max(500).optional(),
	caseSensitive: z.boolean().optional(),
});

const CaseSchema = z.object({
	name: z.string().trim().min(1).max(120),
	input: z.string().trim().min(1).max(8_000),
	checks: z.array(CheckSchema).min(1).max(12),
	tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
});

const CreateSuiteSchema = z.object({
	name: z.string().trim().min(2).max(120),
	description: z.string().trim().max(600).optional(),
	promptId: z.string().trim().min(3).max(128).optional(),
	cases: z.array(CaseSchema).max(MAX_CASES_PER_SUITE).optional(),
});

const UpdateCasesSchema = z.object({
	suiteId: z.string().trim().min(3).max(128),
	cases: z.array(CaseSchema).max(MAX_CASES_PER_SUITE),
});

const RunSchema = z.object({
	suiteId: z.string().trim().min(3).max(128),
	promptId: z.string().trim().min(3).max(128),
	provider: z.enum(["openai", "nvidia", "omniroute"]),
	model: z.string().trim().min(1).max(500).optional(),
	variables: z.record(z.string().max(48), z.string().max(4_000)).optional(),
	action: z.literal("run"),
});

export async function GET(): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;
	try {
		const suites = await listSuites(session.userId);
		return noStoreJson({
			suites: suites.map((suite) => ({
				id: suite.id,
				name: suite.name,
				description: suite.description,
				prompt: suite.prompt,
				caseCount: suite._count.cases,
				runCount: suite._count.runs,
				updatedAt: suite.updatedAt,
			})),
			checkTypes: EVALUATION_CHECK_TYPES,
		});
	} catch (error) {
		return promptErrorResponse(error, "evaluations-list");
	}
}

export async function POST(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const raw = await req
		.clone()
		.json()
		.catch(() => null);

	const runRequest = RunSchema.safeParse(raw);
	if (runRequest.success) {
		try {
			const run = await runSuite({
				userId: session.userId,
				suiteId: runRequest.data.suiteId,
				promptId: runRequest.data.promptId,
				provider: runRequest.data.provider,
				model: runRequest.data.model,
				variables: runRequest.data.variables,
			});
			return noStoreJson({
				run: {
					id: run.id,
					status: run.status,
					providerId: run.providerId,
					model: run.model,
					routingMode: run.routingMode,
					promptVersionId: run.promptVersionId,
					passCount: run.passCount,
					failCount: run.failCount,
					errorCount: run.errorCount,
					durationMs: run.durationMs,
					results: run.results,
					startedAt: run.startedAt,
					finishedAt: run.finishedAt,
				},
			});
		} catch (error) {
			return promptErrorResponse(error, "evaluations-run");
		}
	}

	const body = await readJsonBody(req, CreateSuiteSchema);
	if (!body.ok) return body.response;

	try {
		const suite = await createSuite(session.userId, {
			name: body.data.name,
			description: body.data.description,
			promptId: body.data.promptId,
		});
		if (body.data.cases && body.data.cases.length > 0) {
			const withCases = await replaceSuiteCases(session.userId, suite.id, body.data.cases);
			return noStoreJson({ suite: { id: withCases.id, name: withCases.name } }, { status: 201 });
		}
		return noStoreJson({ suite: { id: suite.id, name: suite.name } }, { status: 201 });
	} catch (error) {
		return promptErrorResponse(error, "evaluations-create");
	}
}

export async function PUT(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, UpdateCasesSchema);
	if (!body.ok) return body.response;

	try {
		const suite = await replaceSuiteCases(session.userId, body.data.suiteId, body.data.cases);
		return noStoreJson({
			suite: {
				id: suite.id,
				name: suite.name,
				cases: suite.cases.map((entry) => ({
					id: entry.id,
					name: entry.name,
					input: entry.input,
					checks: entry.checks,
					tags: entry.tags,
				})),
			},
		});
	} catch (error) {
		return promptErrorResponse(error, "evaluations-cases");
	}
}

export async function DELETE(req: Request): Promise<Response> {
	const session = await requireUserId();
	if (!session.ok) return session.response;

	const body = await readJsonBody(req, z.object({ suiteId: z.string().trim().min(3).max(128) }));
	if (!body.ok) return body.response;

	try {
		return noStoreJson(await deleteSuite(session.userId, body.data.suiteId));
	} catch (error) {
		return promptErrorResponse(error, "evaluations-delete");
	}
}

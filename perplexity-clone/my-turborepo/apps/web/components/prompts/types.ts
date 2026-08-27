/** Shared client-side view models for Prompt Studio. */

export type PromptStatusValue = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type PromptOriginValue = "AIRA_NATIVE" | "USER" | "EXTERNAL_DERIVED";
export type FindingSeverity = "info" | "warning" | "high";

export interface PromptSummary {
	readonly id: string;
	readonly name: string;
	readonly slug: string;
	readonly description: string | null;
	readonly category: string;
	readonly tags: readonly string[];
	readonly status: PromptStatusValue;
	readonly visibility: "PRIVATE" | "WORKSPACE";
	readonly origin: PromptOriginValue;
	readonly versionCount: number;
	readonly publishedVersion: { readonly id: string; readonly version: number } | null;
	readonly updatedAt: string;
}

export interface PromptVariable {
	readonly name: string;
	readonly label?: string;
	readonly description?: string;
	readonly required?: boolean;
	readonly defaultValue?: string;
}

export interface SecurityFinding {
	readonly category: string;
	readonly severity: FindingSeverity;
	readonly message: string;
	readonly evidence?: string;
}

export interface PromptVersionView {
	readonly id: string;
	readonly version: number;
	readonly body: string;
	readonly variables: readonly PromptVariable[];
	readonly providerCompatibility: readonly string[];
	readonly modelCompatibility: readonly string[];
	readonly toolRequirements: readonly string[];
	readonly securityFindings: { readonly findings?: readonly SecurityFinding[] } | null;
	readonly securityMaxSeverity: FindingSeverity | null;
	readonly notes: string | null;
	readonly contentHash: string;
	readonly createdAt: string;
	readonly isPublished: boolean;
}

export interface PromptDetail {
	readonly id: string;
	readonly name: string;
	readonly slug: string;
	readonly description: string | null;
	readonly category: string;
	readonly tags: readonly string[];
	readonly status: PromptStatusValue;
	readonly visibility: "PRIVATE" | "WORKSPACE";
	readonly origin: PromptOriginValue;
	readonly publishedVersionId: string | null;
	readonly externalSource: {
		readonly id: string;
		readonly repository: string;
		readonly path: string;
		readonly url: string;
		readonly commitSha: string;
		readonly title: string;
	} | null;
	readonly updatedAt: string;
	readonly archivedAt: string | null;
}

export interface PromptDetailResponse {
	readonly prompt: PromptDetail;
	readonly versions: readonly PromptVersionView[];
}

export interface AnalyzeResponse {
	readonly analysis: {
		readonly findings: readonly SecurityFinding[];
		readonly counts: Readonly<Record<FindingSeverity, number>>;
		readonly maxSeverity: FindingSeverity | null;
		readonly analyzedCharacters: number;
		readonly protectedLayersEnforced: boolean;
	};
	readonly variables: {
		readonly resolved: readonly string[];
		readonly unresolved: readonly string[];
		readonly unused: readonly string[];
		readonly truncated: readonly string[];
	};
	readonly composition: {
		readonly layers: readonly {
			readonly label: string;
			readonly status: "Active" | "Not used";
			readonly protected: boolean;
			readonly detail: string;
			readonly characters: number;
		}[];
		readonly templateConstraints: readonly string[];
	};
	readonly hierarchy: readonly {
		readonly id: string;
		readonly rank: number;
		readonly label: string;
		readonly protected: boolean;
		readonly description: string;
	}[];
}

export interface ProviderDescriptor {
	readonly id: "openai" | "nvidia" | "omniroute";
	readonly label: string;
	readonly configured: boolean;
	readonly model: string;
	readonly routingModes?: readonly string[];
}

export type RunTargetState = "idle" | "loading" | "streaming" | "success" | "error";

export interface RunTargetView {
	readonly key: string;
	readonly versionId: string;
	readonly versionLabel: string;
	readonly provider: "openai" | "nvidia" | "omniroute";
	readonly model: string;
	state: RunTargetState;
	text: string;
	latencyMs: number | null;
	characters: number | null;
	resolvedModel: string | null;
	error: string | null;
}

export interface ExternalSourceView {
	readonly id: string;
	readonly repository: string;
	readonly path: string;
	readonly url: string;
	readonly commitSha: string;
	readonly contentHash: string;
	readonly title: string;
	readonly category: string;
	readonly sourceLabel: string;
	readonly licenseNotice: string | null;
	readonly tags: readonly string[];
	readonly securityNotes: string | null;
	readonly transformationStatus: "UNREVIEWED" | "REVIEWED" | "TRANSFORMED" | "REJECTED";
	readonly retrievedAt: string;
	readonly analysis: { readonly counts?: Readonly<Record<FindingSeverity, number>> } | null;
}

export interface EvaluationSuiteSummary {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	readonly prompt: { readonly id: string; readonly name: string } | null;
	readonly caseCount: number;
	readonly runCount: number;
	readonly updatedAt: string;
}

export interface EvaluationCheckResultView {
	readonly type: string;
	readonly value?: string;
	readonly passed: boolean;
	readonly detail: string;
}

export interface EvaluationRunView {
	readonly id: string;
	readonly status: "RUNNING" | "COMPLETED" | "FAILED";
	readonly providerId: string;
	readonly model: string;
	readonly routingMode: string | null;
	readonly promptVersionId: string;
	readonly passCount: number;
	readonly failCount: number;
	readonly errorCount: number;
	readonly durationMs: number | null;
	readonly results: readonly {
		readonly caseId: string;
		readonly name: string;
		readonly input: string;
		readonly output: string;
		readonly passed: boolean;
		readonly checks: readonly EvaluationCheckResultView[];
		readonly durationMs: number;
		readonly error?: string;
	}[];
}

export async function readApiError(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: { message?: string } };
		return body.error?.message ?? fallback;
	} catch {
		return fallback;
	}
}

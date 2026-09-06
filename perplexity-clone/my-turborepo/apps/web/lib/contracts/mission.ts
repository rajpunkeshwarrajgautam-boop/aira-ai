import { z } from "zod";
import type { RiskClass } from "../agent-platform/types";

export type DeliverableType =
	| "DOCUMENT"
	| "SPREADSHEET"
	| "PRESENTATION"
	| "DATASET"
	| "CODE_REPOSITORY"
	| "RESEARCH_BRIEF"
	| "WEBSITE_BUNDLE"
	| "IMAGE_ASSET"
	| "AUDIO_ASSET"
	| "ANALYSIS_REPORT"
	| "JSON_PAYLOAD";

export type DeliverableValidationStatus =
	| "PENDING"
	| "VALIDATED"
	| "REJECTED"
	| "REPAIR_REQUIRED";

export type PrivacyMode = "STANDARD" | "TEMPORARY" | "STRICT_ISOLATED";

export type EffortLevel = "low" | "medium" | "high" | "exhaustive";

export interface AcceptanceCriterion {
	readonly id: string;
	readonly description: string;
	readonly requiredEvidence: string[];
	readonly weight: number;
	readonly automatedCheck?: string;
}

export interface DeliverableProvenance {
	readonly codeSha: string;
	readonly promptVersionId: string;
	readonly policyVersionId: string;
	readonly primaryModel: string;
	readonly toolsUsed: readonly string[];
	readonly inputChecksum: string;
	readonly createdAt: string;
	readonly runtimeId?: string;
}

export interface DeliverableCheck {
	readonly criterionId: string;
	readonly passed: boolean;
	readonly score: number;
	readonly notes: string;
	readonly evidenceUri?: string;
}

export interface DeliverableValidation {
	readonly status: DeliverableValidationStatus;
	readonly overallScore: number;
	readonly checks: readonly DeliverableCheck[];
	readonly validatorId: string;
	readonly validatedAt: string;
	readonly feedback?: string;
}

export interface Deliverable {
	readonly id: string;
	readonly type: DeliverableType;
	readonly title: string;
	readonly description: string;
	readonly uri: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
	readonly checksum: string;
	readonly provenance: DeliverableProvenance;
	readonly validation: DeliverableValidation;
	readonly metadata: Record<string, unknown>;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface MissionInput {
	readonly id: string;
	readonly userId: string;
	readonly projectId?: string;
	readonly objective: string;
	readonly context?: Record<string, unknown>;
	readonly constraints: readonly string[];
	readonly expectedDeliverables: readonly {
		readonly type: DeliverableType;
		readonly title: string;
		readonly formatRequirements?: string;
	}[];
	readonly acceptanceCriteria: readonly AcceptanceCriterion[];
	readonly effort: EffortLevel;
	readonly maxCostUsd: number;
	readonly maxTokens: number;
	readonly allowedTools: readonly string[];
	readonly maxRiskClass: RiskClass;
	readonly privacyMode: PrivacyMode;
	readonly preferredModelTiers?: readonly string[];
	readonly createdAt: string;
}

export const AcceptanceCriterionSchema = z.object({
	id: z.string().min(1),
	description: z.string().min(1),
	requiredEvidence: z.array(z.string()),
	weight: z.number().min(0).max(1).default(1.0),
	automatedCheck: z.string().optional(),
});

export const DeliverableSchema = z.object({
	id: z.string().min(1),
	type: z.enum([
		"DOCUMENT",
		"SPREADSHEET",
		"PRESENTATION",
		"DATASET",
		"CODE_REPOSITORY",
		"RESEARCH_BRIEF",
		"WEBSITE_BUNDLE",
		"IMAGE_ASSET",
		"AUDIO_ASSET",
		"ANALYSIS_REPORT",
		"JSON_PAYLOAD",
	]),
	title: z.string().min(1),
	description: z.string().default(""),
	uri: z.string().min(1),
	mimeType: z.string().min(1),
	sizeBytes: z.number().nonnegative(),
	checksum: z.string().min(1),
	provenance: z.object({
		codeSha: z.string().min(1),
		promptVersionId: z.string().min(1),
		policyVersionId: z.string().min(1),
		primaryModel: z.string().min(1),
		toolsUsed: z.array(z.string()),
		inputChecksum: z.string().min(1),
		createdAt: z.string(),
		runtimeId: z.string().optional(),
	}),
	validation: z.object({
		status: z.enum(["PENDING", "VALIDATED", "REJECTED", "REPAIR_REQUIRED"]),
		overallScore: z.number().min(0).max(100),
		checks: z.array(
			z.object({
				criterionId: z.string(),
				passed: z.boolean(),
				score: z.number().min(0).max(100),
				notes: z.string(),
				evidenceUri: z.string().optional(),
			}),
		),
		validatorId: z.string(),
		validatedAt: z.string(),
		feedback: z.string().optional(),
	}),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const MissionInputSchema = z.object({
	id: z.string().min(1),
	userId: z.string().min(1),
	projectId: z.string().optional(),
	objective: z.string().min(1),
	context: z.record(z.string(), z.unknown()).optional(),
	constraints: z.array(z.string()).default([]),
	expectedDeliverables: z.array(
		z.object({
			type: z.enum([
				"DOCUMENT",
				"SPREADSHEET",
				"PRESENTATION",
				"DATASET",
				"CODE_REPOSITORY",
				"RESEARCH_BRIEF",
				"WEBSITE_BUNDLE",
				"IMAGE_ASSET",
				"AUDIO_ASSET",
				"ANALYSIS_REPORT",
				"JSON_PAYLOAD",
			]),
			title: z.string().min(1),
			formatRequirements: z.string().optional(),
		}),
	).default([]),
	acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
	effort: z.enum(["low", "medium", "high", "exhaustive"]).default("medium"),
	maxCostUsd: z.number().positive().default(10.0),
	maxTokens: z.number().positive().default(200_000),
	allowedTools: z.array(z.string()).default([]),
	maxRiskClass: z.enum(["LOW", "MEDIUM", "HIGH", "PROTECTED"]).default("MEDIUM"),
	privacyMode: z.enum(["STANDARD", "TEMPORARY", "STRICT_ISOLATED"]).default("STANDARD"),
	preferredModelTiers: z.array(z.string()).optional(),
	createdAt: z.string(),
});

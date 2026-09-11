import { z } from "zod";

export type VerticalPackId =
	| "meeting-intelligence"
	| "sales-prospecting"
	| "marketing-os"
	| "content-studio"
	| "payment-analytics"
	| "job-search"
	| "legal-pack"
	| "finance-analysis"
	| "travel-agent"
	| "transaction-risk"
	| "sensitive-data"
	| "tutor-skills"
	| "file-organizer"
	| "desktop-computer";

export interface VerticalPackDefinition {
	readonly id: VerticalPackId;
	readonly name: string;
	readonly gateNumber: number;
	readonly description: string;
	readonly defaultRisk: "LOW" | "MEDIUM" | "HIGH" | "PROTECTED";
	readonly requiredSkills: readonly string[];
	readonly supportedDeliverables: readonly string[];
	readonly humanReviewRequired: boolean;
	readonly constraints: readonly string[];
}

export const VerticalPacks: readonly VerticalPackDefinition[] = [
	{
		id: "meeting-intelligence",
		name: "Meeting Intelligence & Synthesis",
		gateNumber: 79,
		description: "Audio transcript summarization, action item assignment, and calendar follow-up draft generation.",
		defaultRisk: "LOW",
		requiredSkills: ["analytics", "launch-storytelling"],
		supportedDeliverables: ["DOCUMENT", "ANALYSIS_REPORT"],
		humanReviewRequired: false,
		constraints: ["Do not disclose private internal attendee email addresses."],
	},
	{
		id: "sales-prospecting",
		name: "B2B Sales Prospecting & Enrichment",
		gateNumber: 83,
		description: "Account identification, executive persona enrichment, CRM lead export, and compliance controls.",
		defaultRisk: "MEDIUM",
		requiredSkills: ["analytics", "product-discovery"],
		supportedDeliverables: ["SPREADSHEET", "DATASET"],
		humanReviewRequired: true,
		constraints: ["Respect CAN-SPAM and GDPR consent fences."],
	},
	{
		id: "marketing-os",
		name: "Autonomous Marketing OS",
		gateNumber: 84,
		description: "Campaign briefs, audience segment analysis, multichannel content assets, and review bounds.",
		defaultRisk: "MEDIUM",
		requiredSkills: ["growth-loops", "ai-ad-creative"],
		supportedDeliverables: ["DOCUMENT", "PRESENTATION"],
		humanReviewRequired: true,
		constraints: ["Strict brand guideline compliance."],
	},
	{
		id: "content-studio",
		name: "Multimodal Content Studio",
		gateNumber: 87,
		description: "Blog posts, whitepapers, social snippets, image prompts, and editorial calendars.",
		defaultRisk: "LOW",
		requiredSkills: ["blog-writing", "creative-communications"],
		supportedDeliverables: ["DOCUMENT", "IMAGE_ASSET"],
		humanReviewRequired: false,
		constraints: ["Verify factual citations before generating editorial claims."],
	},
	{
		id: "payment-analytics",
		name: "Payment & Subscription Analytics",
		gateNumber: 90,
		description: "Churn curves, cohort MRR expansion, failed payment recovery, and processor fee audits.",
		defaultRisk: "LOW",
		requiredSkills: ["analytics", "burn-rate-management"],
		supportedDeliverables: ["SPREADSHEET", "ANALYSIS_REPORT"],
		humanReviewRequired: false,
		constraints: ["Redact all PAN, CVV, and raw banking account credentials."],
	},
	{
		id: "job-search",
		name: "Executive Career & Job Search Agent",
		gateNumber: 91,
		description: "Resume gap analysis, ATS score optimization, compensation benchmarking, and cover letter synthesis.",
		defaultRisk: "LOW",
		requiredSkills: ["launch-storytelling"],
		supportedDeliverables: ["DOCUMENT"],
		humanReviewRequired: false,
		constraints: ["Maintain privacy of applicant current employer."],
	},
	{
		id: "legal-pack",
		name: "Legal Research & Contract Analysis",
		gateNumber: 92,
		description: "Jurisdictional statutory research, clause risk rating, NDA/MSA redline drafting, and human counsel disclaimers.",
		defaultRisk: "HIGH",
		requiredSkills: ["decision-maker", "privacy-guardian"],
		supportedDeliverables: ["DOCUMENT"],
		humanReviewRequired: true,
		constraints: [
			"MANDATORY: Provide clear disclaimer that output is automated research and does not constitute formal legal counsel.",
		],
	},
	{
		id: "finance-analysis",
		name: "Quantitative Financial Analysis Pack",
		gateNumber: 93,
		description: "DCF valuations, sensitivity models, 3-statement projections, and reproducible spreadsheet formulas.",
		defaultRisk: "LOW",
		requiredSkills: ["burn-rate-management", "analytics"],
		supportedDeliverables: ["SPREADSHEET", "ANALYSIS_REPORT"],
		humanReviewRequired: false,
		constraints: ["All formulas must be mathematically verifiable and cite baseline inputs."],
	},
	{
		id: "travel-agent",
		name: "Autonomous Corporate Travel Agent",
		gateNumber: 94,
		description: "Multi-city itineraries, policy-compliant air/hotel comparison, and cost optimization.",
		defaultRisk: "HIGH",
		requiredSkills: ["decision-maker"],
		supportedDeliverables: ["DOCUMENT"],
		humanReviewRequired: true,
		constraints: ["Booking or payment mutation requires strict executive confirmation step-up."],
	},
	{
		id: "transaction-risk",
		name: "Transaction Risk & Reversal Framework",
		gateNumber: 95,
		description: "Threshold spend limits, dual-custody authorization, idempotent receipts, and rollback semantics.",
		defaultRisk: "PROTECTED",
		requiredSkills: ["security-owasp", "audit-my-app"],
		supportedDeliverables: ["JSON_PAYLOAD", "ANALYSIS_REPORT"],
		humanReviewRequired: true,
		constraints: ["Strict step-up approval required for any transaction exceeding $100."],
	},
	{
		id: "sensitive-data",
		name: "Sensitive Data Connector Guardrails",
		gateNumber: 96,
		description: "Automatic PII detection, redaction, HIPAA/GDPR sanitization pipelines, and differential privacy.",
		defaultRisk: "HIGH",
		requiredSkills: ["privacy-guardian", "cybersecurity"],
		supportedDeliverables: ["DATASET", "DOCUMENT"],
		humanReviewRequired: false,
		constraints: ["Never transmit unmasked social security numbers, medical records, or API keys."],
	},
	{
		id: "tutor-skills",
		name: "Socratic Academic & Technical Tutor",
		gateNumber: 97,
		description: "Interactive Socratic dialogue, step-by-step mathematical proofs, code review pedagogy, and quizzes.",
		defaultRisk: "LOW",
		requiredSkills: ["education-platforms", "scientific-method"],
		supportedDeliverables: ["DOCUMENT"],
		humanReviewRequired: false,
		constraints: ["Foster guided comprehension rather than dispensing unverified shortcut solutions."],
	},
	{
		id: "file-organizer",
		name: "Intelligent File Organization Agent",
		gateNumber: 98,
		description: "Semantic duplicate removal, taxonomy restructuring, metadata tagging, and safe staging moves.",
		defaultRisk: "MEDIUM",
		requiredSkills: ["backend"],
		supportedDeliverables: ["JSON_PAYLOAD"],
		humanReviewRequired: true,
		constraints: ["Staging dry-run preview required prior to filesystem mutative operations."],
	},
	{
		id: "desktop-computer",
		name: "Desktop OS Automation Agent",
		gateNumber: 99,
		description: "Screen inspection, IPC coordinate dispatch, cross-application window control, and safety kill-switches.",
		defaultRisk: "HIGH",
		requiredSkills: ["drive-desktop-app", "browser-automation"],
		supportedDeliverables: ["DOCUMENT"],
		humanReviewRequired: true,
		constraints: ["Fail closed if IPC security handshake token does not match."],
	},
];

export class VerticalPackService {
	listPacks(): readonly VerticalPackDefinition[] {
		return VerticalPacks;
	}

	getPack(id: VerticalPackId): VerticalPackDefinition | undefined {
		return VerticalPacks.find((p) => p.id === id);
	}

	executePackValidation(id: VerticalPackId, inputPayload: Record<string, unknown>): {
		allowed: boolean;
		requiresStepUpApproval: boolean;
		sanitizedPayload: Record<string, unknown>;
		disclaimers: string[];
	} {
		const pack = this.getPack(id);
		if (!pack) throw new Error(`Vertical pack ${id} does not exist`);

		const disclaimers: string[] = [];
		if (pack.id === "legal-pack") {
			disclaimers.push("Automated legal research only. Consult licensed counsel before signing contracts.");
		}
		if (pack.id === "transaction-risk") {
			disclaimers.push("Dual-custody verification active: transactions above threshold are held in escrow.");
		}

		// Check sensitive data scrubbing (Gate 96)
		const sanitizedPayload = { ...inputPayload };
		for (const [key, value] of Object.entries(sanitizedPayload)) {
			if (typeof value === "string") {
				// Redact credit cards and SSNs
				sanitizedPayload[key] = value
					.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[REDACTED_PAN]")
					.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
			}
		}

		return {
			allowed: true,
			requiresStepUpApproval: pack.humanReviewRequired || pack.defaultRisk === "HIGH" || pack.defaultRisk === "PROTECTED",
			sanitizedPayload,
			disclaimers,
		};
	}
}

export const globalVerticalPackService = new VerticalPackService();

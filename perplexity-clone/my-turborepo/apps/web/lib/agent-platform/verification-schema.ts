import { z } from "zod";

export const VerificationCriterionSchema = z.object({
	criterionId: z.string().trim().min(1),
	passed: z.boolean(),
	evidence: z.array(z.string().trim().min(1)).min(1),
});

export const VerificationResultSchema = z.object({
	criteria: z.array(VerificationCriterionSchema).min(1),
	requiredEvidencePresent: z.boolean(),
	overallPassed: z.boolean(),
	summary: z.string().trim().min(1),
}).superRefine((data, ctx) => {
	// Rule: One criterion false + overallPassed=true MUST be rejected
	const anyCriterionFailed = data.criteria.some((c) => !c.passed);
	if (anyCriterionFailed && data.overallPassed) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "overallPassed cannot be true when one or more criteria have passed=false",
			path: ["overallPassed"],
		});
	}

	// Rule: requiredEvidencePresent=false + overallPassed=true MUST be rejected
	if (!data.requiredEvidencePresent && data.overallPassed) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "overallPassed cannot be true when requiredEvidencePresent is false",
			path: ["overallPassed"],
		});
	}

	// Rule: Every passed criterion must have substantive, resolvable evidence
	for (const [i, crit] of data.criteria.entries()) {
		if (crit.passed) {
			const resolvable = crit.evidence.filter(
				(e) => e && e.trim().length >= 5 && !/^(?:\.{2,}|none|n\/a|null|undefined|placeholder|tbd)$/i.test(e.trim())
			);
			if (resolvable.length === 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Criterion "${crit.criterionId}" marked passed without substantive resolvable evidence`,
					path: ["criteria", i, "evidence"],
				});
			}
		}
	}
});

export interface RuntimeSkill {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly instructions: string;
	readonly requiredTools: readonly string[];
	readonly preferredRoles: readonly string[];
	readonly keywords: readonly string[];
}

export const BUILTIN_SKILLS: readonly RuntimeSkill[] = [
	{
		id: "research",
		name: "Technical Research",
		description: "Find current, implementation-relevant evidence and return concise decisions.",
		instructions: "Prefer primary/official sources. Separate evidence from inference. Record source references when the runtime supports artifacts/citations.",
		requiredTools: ["web"],
		preferredRoles: ["RESEARCH", "ARCHITECT", "SECURITY"],
		keywords: ["research", "current", "docs", "compare", "competitor"],
	},
	{
		id: "web-app-builder",
		name: "Web App Builder",
		description: "Implement production web applications with connected frontend/backend contracts.",
		instructions: "Inspect the existing app before editing. Prefer additive changes, isolated worktrees, type-safe boundaries, real loading/error/empty states, and executable validation.",
		requiredTools: ["git", "terminal", "files"],
		preferredRoles: ["FRONTEND", "BACKEND", "INTEGRATOR"],
		keywords: ["app", "website", "frontend", "backend", "next", "react"],
	},
	{
		id: "database-migration",
		name: "Safe Database Migration",
		description: "Design additive PostgreSQL/Supabase migrations with explicit authorization boundaries.",
		instructions: "Use parameterized SQL, indexes/constraints deliberately, preserve RLS/server ownership, validate migrations, and never apply production changes without protected approval.",
		requiredTools: ["git", "terminal"],
		preferredRoles: ["DATABASE", "SECURITY"],
		keywords: ["database", "postgres", "supabase", "migration", "schema"],
	},
	{
		id: "security-review",
		name: "Agentic Security Review",
		description: "Threat-model autonomous execution boundaries and prove important denials.",
		instructions: "Test cross-user IDs, prompt injection, SSRF including redirects/DNS, traversal, shell/tool escalation, secret redaction, approval bypass, and worker isolation assumptions.",
		requiredTools: ["files", "terminal"],
		preferredRoles: ["SECURITY", "VERIFICATION"],
		keywords: ["security", "auth", "ssrf", "secret", "threat", "permission"],
	},
	{
		id: "browser-qa",
		name: "Browser QA",
		description: "Validate real UI behavior in an isolated browser session.",
		instructions: "Test critical flows, responsive widths, console/page/network errors, clipping/overflow, keyboard basics, and truthful states. Capture evidence instead of assuming render success.",
		requiredTools: ["browser"],
		preferredRoles: ["BROWSER", "QA", "VERIFICATION"],
		keywords: ["browser", "responsive", "ui", "qa", "visual"],
	},
	{
		id: "deployment-verification",
		name: "Deployment Verification",
		description: "Prepare and independently verify deployment evidence.",
		instructions: "Deploy only reviewed/tested revisions after required approval. Record immutable revision/deployment IDs and verify the actual target before claiming production success.",
		requiredTools: ["vercel", "github"],
		preferredRoles: ["DEVOPS", "VERIFICATION"],
		keywords: ["deploy", "production", "vercel", "publish", "ship"],
	},
];

function tokens(value: string): Set<string> {
	return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length > 2));
}

export function selectRuntimeSkills(input: {
	readonly role: string;
	readonly objective: string;
	readonly availableTools: Readonly<Record<string, boolean>>;
	readonly limit?: number;
}): RuntimeSkill[] {
	const query = tokens(input.objective);
	return BUILTIN_SKILLS
		.map((skill) => {
			const roleScore = skill.preferredRoles.includes(input.role) ? 8 : 0;
			const keywordScore = skill.keywords.reduce((score, keyword) => score + (query.has(keyword) ? 2 : 0), 0);
			const toolsAvailable = skill.requiredTools.every((tool) => input.availableTools[tool] === true);
			return { skill, score: toolsAvailable ? roleScore + keywordScore : -1 };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, Math.min(4, input.limit ?? 3)))
		.map((entry) => entry.skill);
}

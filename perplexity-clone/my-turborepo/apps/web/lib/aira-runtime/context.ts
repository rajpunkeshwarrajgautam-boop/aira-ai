import { retrieveProjectMemory } from "@/lib/agent-platform/project-memory";

import { buildCapabilityManifest, type CapabilityManifest } from "./capabilities";
import {
	AIRA_CONSTITUTION,
	AIRA_PLATFORM_POLICY,
	AIRA_TOOL_POLICY,
	rolePolicy,
} from "./policies";
import { selectRuntimeSkills } from "./skills";

export interface RuntimeContextInput {
	readonly userId: string;
	readonly projectId: string;
	readonly runId: string;
	readonly taskId: string;
	readonly role: string;
	readonly taskTitle: string;
	readonly objective: string;
	readonly allowedTools: readonly string[];
}

export interface BuiltRuntimeContext {
	readonly systemPrompt: string;
	readonly capabilityManifest: CapabilityManifest;
	readonly selectedSkillIds: readonly string[];
	readonly memoryKeys: readonly string[];
}

function availableToolMap(manifest: CapabilityManifest): Record<string, boolean> {
	return {
		web: manifest.web,
		browser: manifest.browser,
		files: manifest.files,
		memory: manifest.memory,
		git: manifest.git,
		terminal: manifest.terminal,
		github: manifest.github,
		vercel: manifest.vercel,
		supabase: manifest.supabase,
		mcp: manifest.mcp,
	};
}

export async function buildRuntimeContext(input: RuntimeContextInput): Promise<BuiltRuntimeContext> {
	const [manifest, memories] = await Promise.all([
		buildCapabilityManifest(input.userId),
		retrieveProjectMemory({
			userId: input.userId,
			projectId: input.projectId,
			query: `${input.role} ${input.taskTitle} ${input.objective}`,
			limit: 8,
		}).catch(() => []),
	]);
	const toolMap = availableToolMap(manifest);
	const availableAssignedTools = input.allowedTools.filter((tool) => toolMap[tool] === true);
	const selectedSkills = selectRuntimeSkills({
		role: input.role,
		objective: `${input.taskTitle} ${input.objective}`,
		availableTools: toolMap,
	});

	const prompt = [
		"# AIRA CONSTITUTION",
		AIRA_CONSTITUTION,
		"# PLATFORM PRECEDENCE / UNTRUSTED-CONTENT BOUNDARY",
		AIRA_PLATFORM_POLICY,
		"# TOOL POLICY",
		AIRA_TOOL_POLICY,
		"# LIVE CAPABILITY MANIFEST",
		JSON.stringify({
			tools: toolMap,
			assignedAvailableTools: availableAssignedTools,
			runtimes: manifest.runtimes,
			localModels: manifest.localModels,
		}, null, 2),
		`# SPECIALIST ROLE: ${input.role}`,
		rolePolicy(input.role),
		"# SELECTED SKILLS",
		selectedSkills.length
			? selectedSkills.map((skill) => `## ${skill.name}\n${skill.instructions}`).join("\n\n")
			: "No additional reusable skill is required for this task.",
		"# RELEVANT PROJECT MEMORY",
		memories.length
			? memories.map((memory) => `- [${memory.kind}/${memory.memoryKey}] ${memory.content}`).join("\n")
			: "No relevant stored project memory was retrieved.",
		"# ASSIGNED TASK",
		`Mission: ${input.runId}\nTask: ${input.taskTitle}\nObjective: ${input.objective}`,
		"# OUTPUT CONTRACT",
		"Return a concise handoff containing: summary, artifacts/evidence, decisions, risks/blockers, and nextActions. Never claim a tool action occurred unless its result is present in your runtime evidence.",
	].join("\n\n");

	return {
		systemPrompt: prompt,
		capabilityManifest: manifest,
		selectedSkillIds: selectedSkills.map((skill) => skill.id),
		memoryKeys: memories.map((memory) => memory.memoryKey),
	};
}

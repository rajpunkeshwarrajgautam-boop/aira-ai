import { z } from "zod";

import { globalSkillsStore } from "@/lib/agents/installable-skills-store";
import { globalUserAgentStore } from "@/lib/agents/user-agents-store";
import { prisma } from "@/lib/prisma";
import { registeredToolIds } from "@/lib/tool-gateway/gateway";

import type { AgentModelTier, RunBudgets, TaskSpec } from "./types";

const TeamRoleSchema = z.enum([
  "PRODUCT", "RESEARCH", "ARCHITECT", "UI_UX", "FRONTEND", "BACKEND",
  "DATABASE", "SECURITY", "INTEGRATOR", "QA", "BROWSER", "DEVOPS", "VERIFICATION",
]);

const ModelTierSchema = z.enum(["fast", "balanced", "reasoning", "coding", "vision", "long-context", "local"]);

export const AgentTeamMemberSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  title: z.string().trim().min(2).max(120),
  role: TeamRoleSchema,
  agentDefinitionId: z.string().trim().min(1).optional(),
  objectiveTemplate: z.string().trim().min(3).max(4_000),
  modelTier: ModelTierSchema.default("balanced"),
  tools: z.array(z.string().trim().min(1)).max(20).default([]),
  skills: z.array(z.string().trim().min(1)).max(20).default([]),
  dependencies: z.array(z.string().trim().min(1)).max(16).default([]),
  priority: z.number().int().min(0).max(100).default(50),
});

export const AgentTeamBudgetsSchema = z.object({
  maxAgents: z.number().int().min(2).max(24).default(12),
  maxParallelAgents: z.number().int().min(1).max(6).default(4),
  maxToolCalls: z.number().int().min(10).max(500).default(160),
  maxTokens: z.number().int().min(10_000).max(2_000_000).default(500_000),
  maxCostUsd: z.number().min(0).max(250).default(20),
  maxDurationMinutes: z.number().int().min(10).max(1_440).default(180),
  maxRetries: z.number().int().min(0).max(5).default(2),
});

export const CoordinatorPolicySchema = z.object({
  handoffMode: z.literal("DIRECT_DEPENDENCIES").default("DIRECT_DEPENDENCIES"),
  requireIndependentVerification: z.boolean().default(true),
  maxHandoffsPerTask: z.number().int().min(1).max(20).default(8),
});

export const AgentTeamDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).default(""),
  members: z.array(AgentTeamMemberSchema).min(2).max(16),
  budgets: AgentTeamBudgetsSchema.default({}),
  coordinatorPolicy: CoordinatorPolicySchema.default({}),
});

export type AgentTeamMember = z.infer<typeof AgentTeamMemberSchema>;
export type AgentTeamDefinition = z.infer<typeof AgentTeamDefinitionSchema>;

export interface AgentTeamRecord extends AgentTeamDefinition {
  readonly id: string;
  readonly userId: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTeamVersionRecord {
  readonly version: number;
  readonly definition: AgentTeamDefinition;
  readonly createdAt: string;
}

export interface CompiledTeamTaskConfig {
  readonly teamId: string;
  readonly teamVersion: number;
  readonly memberKey: string;
  readonly agentDefinitionId?: string;
  readonly agentName?: string;
  readonly instructions?: string;
  readonly allowedTools: readonly string[];
  readonly skillIds: readonly string[];
}

type TeamRow = {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: string;
  version: number;
  members: unknown;
  budgets: unknown;
  coordinatorPolicy: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: TeamRow): AgentTeamRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    status: row.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    version: row.version,
    members: z.array(AgentTeamMemberSchema).parse(row.members),
    budgets: AgentTeamBudgetsSchema.parse(row.budgets),
    coordinatorPolicy: CoordinatorPolicySchema.parse(row.coordinatorPolicy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertDag(members: readonly AgentTeamMember[]): void {
  const keys = new Set<string>();
  for (const member of members) {
    if (keys.has(member.key)) throw new Error(`Duplicate team member key: ${member.key}`);
    keys.add(member.key);
  }
  for (const member of members) {
    for (const dependency of member.dependencies) {
      if (!keys.has(dependency)) throw new Error(`Member ${member.key} depends on unknown member ${dependency}.`);
      if (dependency === member.key) throw new Error(`Member ${member.key} cannot depend on itself.`);
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  const byKey = new Map(members.map((member) => [member.key, member]));
  const visit = (key: string): void => {
    const current = state.get(key) ?? 0;
    if (current === 1) throw new Error("Agent Team dependency graph contains a cycle.");
    if (current === 2) return;
    state.set(key, 1);
    for (const dependency of byKey.get(key)?.dependencies ?? []) visit(dependency);
    state.set(key, 2);
  };
  for (const member of members) visit(member.key);
}

async function validateReferences(userId: string, definition: AgentTeamDefinition): Promise<void> {
  assertDag(definition.members);
  if (definition.budgets.maxAgents < definition.members.length) {
    throw new Error(`Team has ${definition.members.length} members but maxAgents is ${definition.budgets.maxAgents}.`);
  }

  const registeredTools = new Set<string>(registeredToolIds());
  for (const member of definition.members) {
    let inheritedTools: readonly string[] = [];
    let inheritedSkills: readonly string[] = [];

    if (member.agentDefinitionId) {
      const agent = await globalUserAgentStore.getAgentAsync(userId, member.agentDefinitionId);
      if (!agent || agent.userId !== userId) {
        throw new Error(`Agent definition ${member.agentDefinitionId} is not owned by this user.`);
      }
      inheritedTools = agent.tools;
      inheritedSkills = agent.skills;
    }

    const tools = [...new Set([...inheritedTools, ...member.tools])];
    const unknownTools = tools.filter((tool) => !registeredTools.has(tool));
    if (unknownTools.length) {
      throw new Error(`Member ${member.key} references unknown Tool Gateway id(s): ${unknownTools.join(", ")}.`);
    }

    const skills = [...new Set([...inheritedSkills, ...member.skills])];
    for (const skillId of skills) {
      const skill = await globalSkillsStore.getSkillForUserAsync(userId, skillId);
      if (!skill || !skill.enabled) {
        throw new Error(`Member ${member.key} references unavailable skill ${skillId}.`);
      }
    }
  }

  if (definition.coordinatorPolicy.requireIndependentVerification &&
      !definition.members.some((member) => member.role === "VERIFICATION")) {
    throw new Error("This team requires independent verification but has no VERIFICATION member.");
  }
}

function snapshot(definition: AgentTeamDefinition): string {
  return JSON.stringify(definition);
}

export async function listAgentTeams(userId: string): Promise<AgentTeamRecord[]> {
  const rows = await prisma.$queryRaw<TeamRow[]>`
    select * from "AgentTeam"
    where "userId"=${userId}
    order by "updatedAt" desc
  `;
  return rows.map(toRecord);
}

export async function getAgentTeam(userId: string, teamId: string): Promise<AgentTeamRecord | null> {
  const rows = await prisma.$queryRaw<TeamRow[]>`
    select * from "AgentTeam"
    where "id"=${teamId} and "userId"=${userId}
    limit 1
  `;
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function createAgentTeam(userId: string, input: AgentTeamDefinition): Promise<AgentTeamRecord> {
  const definition = AgentTeamDefinitionSchema.parse(input);
  await validateReferences(userId, definition);
  const id = crypto.randomUUID();
  const members = JSON.stringify(definition.members);
  const budgets = JSON.stringify(definition.budgets);
  const coordinatorPolicy = JSON.stringify(definition.coordinatorPolicy);
  const definitionJson = snapshot(definition);

  await prisma.$transaction([
    prisma.$executeRaw`
      insert into "AgentTeam" (
        "id","userId","name","description","status","version","members","budgets","coordinatorPolicy"
      ) values (
        ${id},${userId},${definition.name},${definition.description},'ACTIVE',1,
        ${members}::jsonb,${budgets}::jsonb,${coordinatorPolicy}::jsonb
      )
    `,
    prisma.$executeRaw`
      insert into "AgentTeamVersion" ("id","teamId","version","definition")
      values (${crypto.randomUUID()},${id},1,${definitionJson}::jsonb)
    `,
  ]);

  return (await getAgentTeam(userId, id))!;
}

export async function updateAgentTeam(
  userId: string,
  teamId: string,
  input: AgentTeamDefinition,
): Promise<AgentTeamRecord | null> {
  const current = await getAgentTeam(userId, teamId);
  if (!current) return null;
  const definition = AgentTeamDefinitionSchema.parse(input);
  await validateReferences(userId, definition);
  const nextVersion = current.version + 1;
  const members = JSON.stringify(definition.members);
  const budgets = JSON.stringify(definition.budgets);
  const coordinatorPolicy = JSON.stringify(definition.coordinatorPolicy);
  const definitionJson = snapshot(definition);

  const changed = await prisma.$transaction(async (tx) => {
    const count = await tx.$executeRaw`
      update "AgentTeam"
      set "name"=${definition.name},
          "description"=${definition.description},
          "members"=${members}::jsonb,
          "budgets"=${budgets}::jsonb,
          "coordinatorPolicy"=${coordinatorPolicy}::jsonb,
          "version"=${nextVersion},
          "updatedAt"=current_timestamp
      where "id"=${teamId} and "userId"=${userId} and "version"=${current.version}
    `;
    if (count !== 1) return false;
    await tx.$executeRaw`
      insert into "AgentTeamVersion" ("id","teamId","version","definition")
      values (${crypto.randomUUID()},${teamId},${nextVersion},${definitionJson}::jsonb)
    `;
    return true;
  });
  if (!changed) throw new Error("Team changed concurrently. Refresh and try again.");
  return getAgentTeam(userId, teamId);
}

export async function archiveAgentTeam(userId: string, teamId: string): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    update "AgentTeam"
    set "status"='ARCHIVED', "updatedAt"=current_timestamp
    where "id"=${teamId} and "userId"=${userId}
  `;
  return changed === 1;
}

export async function listAgentTeamVersions(userId: string, teamId: string): Promise<AgentTeamVersionRecord[]> {
  const team = await getAgentTeam(userId, teamId);
  if (!team) return [];
  const rows = await prisma.$queryRaw<Array<{ version: number; definition: unknown; createdAt: Date }>>`
    select v."version",v."definition",v."createdAt"
    from "AgentTeamVersion" v
    join "AgentTeam" t on t."id"=v."teamId"
    where v."teamId"=${teamId} and t."userId"=${userId}
    order by v."version" desc
  `;
  return rows.map((row) => ({
    version: row.version,
    definition: AgentTeamDefinitionSchema.parse(row.definition),
    createdAt: row.createdAt.toISOString(),
  }));
}

function renderObjective(template: string, objective: string): string {
  return template.includes("{{objective}}")
    ? template.replaceAll("{{objective}}", objective)
    : `${template}\n\nMission objective: ${objective}`;
}

export async function compileAgentTeam(
  userId: string,
  team: AgentTeamRecord,
  objective: string,
): Promise<Array<TaskSpec & { config: CompiledTeamTaskConfig }>> {
  await validateReferences(userId, team);

  const tasks: Array<TaskSpec & { config: CompiledTeamTaskConfig }> = [];
  for (const member of team.members) {
    const agent = member.agentDefinitionId
      ? await globalUserAgentStore.getAgentAsync(userId, member.agentDefinitionId)
      : null;
    if (agent && agent.userId !== userId) throw new Error("Agent definition ownership changed.");

    const allowedTools = [...new Set([...(agent?.tools ?? []), ...member.tools])];
    const skillIds = [...new Set([...(agent?.skills ?? []), ...member.skills])];
    tasks.push({
      key: member.key,
      title: member.title,
      objective: renderObjective(member.objectiveTemplate, objective),
      agentRole: member.role,
      modelTier: member.modelTier as AgentModelTier,
      priority: member.priority,
      dependencies: member.dependencies,
      config: {
        teamId: team.id,
        teamVersion: team.version,
        memberKey: member.key,
        ...(agent ? {
          agentDefinitionId: agent.id,
          agentName: agent.name,
          instructions: agent.instructions,
        } : {}),
        allowedTools,
        skillIds,
      },
    });
  }
  return tasks;
}

export function teamBudgets(team: AgentTeamRecord): RunBudgets {
  return AgentTeamBudgetsSchema.parse(team.budgets);
}

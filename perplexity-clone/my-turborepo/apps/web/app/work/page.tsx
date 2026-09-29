import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkExecutionWorkspace } from "@/components/work/WorkExecutionWorkspace";
import { auth } from "@/auth";
import { getProjectForUser } from "@/lib/agent-platform/store";

export const metadata: Metadata = {
  title: "Work Mode — AIRA AI",
  description: "Autonomous outcome engine backed by AIRA's persisted managed-run platform.",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function WorkPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawIntent = firstParam(params.intent);
  const commandIntent = rawIntent === "plan" || rawIntent === "agent" || rawIntent === "team" ? rawIntent : null;
  const teamId = firstParam(params.teamId).trim().slice(0, 128);
  const projectId = firstParam(params.projectId).trim().slice(0, 128);

  let projectObjective = "";
  if (projectId) {
    const session = await auth();
    if (session?.user?.id) {
      const project = await getProjectForUser(session.user.id, projectId);
      if (
        project &&
        project.config?.source === "intent-router" &&
        project.config?.intent === "AGENT_MISSION" &&
        project.config?.launchAuthorized === false
      ) {
        projectObjective = project.objective.trim().slice(0, 8_000);
      }
    }
  }

  const explicitObjective = firstParam(params.objective).trim().slice(0, 8_000);
  const initialObjective = explicitObjective || projectObjective;
  const autoPlan = Boolean(commandIntent && initialObjective.length >= 3);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <WorkExecutionWorkspace
          initialObjective={initialObjective}
          autoPlan={autoPlan}
          commandIntent={commandIntent}
          teamId={teamId || undefined}
        />
      </AiraV2Frame>
    </div>
  );
}

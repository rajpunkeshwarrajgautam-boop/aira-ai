import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkExecutionWorkspace } from "@/components/work/WorkExecutionWorkspace";

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
  const initialObjective = firstParam(params.objective).trim().slice(0, 8_000);
  const rawIntent = firstParam(params.intent);
  const commandIntent = rawIntent === "plan" || rawIntent === "agent" || rawIntent === "team" ? rawIntent : null;
  const autoPlan = Boolean(commandIntent && initialObjective.length >= 3);

  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <WorkExecutionWorkspace
          initialObjective={initialObjective}
          autoPlan={autoPlan}
          commandIntent={commandIntent}
        />
      </AiraV2Frame>
    </div>
  );
}

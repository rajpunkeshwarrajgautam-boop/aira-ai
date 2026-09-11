import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkExecutionWorkspace } from "@/components/work/WorkExecutionWorkspace";

export const metadata: Metadata = {
  title: "Work Mode — AIRA AI",
  description: "Autonomous outcome engine backed by AIRA's persisted managed-run platform.",
};

export default function WorkPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <WorkExecutionWorkspace />
      </AiraV2Frame>
    </div>
  );
}

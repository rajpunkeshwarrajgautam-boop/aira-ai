import { Suspense } from "react";
import type { Metadata } from "next";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkflowWorkspace } from "@/components/workflows/WorkflowWorkspace";

export const metadata: Metadata = {
  title: "Workflows — AIRA AI",
  description: "Create and execute durable AIRA automation routines and workflow DAGs.",
};

export default function WorkflowsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <Suspense fallback={<div className="p-8 text-sm text-[#71717A]">Loading workflows…</div>}>
          <WorkflowWorkspace />
        </Suspense>
      </AiraV2Frame>
    </div>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { ProjectsWorkspace } from "@/components/projects/ProjectsWorkspace";

export const metadata: Metadata = {
  title: "Projects — AIRA AI",
  description: "Persistent project context, managed runs and project artifacts.",
};

export default function ProjectsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <Suspense fallback={<div className="min-h-[calc(100dvh-58px)] bg-[#090b0e]" aria-hidden />}>
          <ProjectsWorkspace />
        </Suspense>
      </AiraV2Frame>
    </div>
  );
}

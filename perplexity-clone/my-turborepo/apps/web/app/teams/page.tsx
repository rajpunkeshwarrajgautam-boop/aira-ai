import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { TeamsWorkspace } from "@/components/teams/TeamsWorkspace";

export const metadata: Metadata = {
  title: "Agent Teams — AIRA AI",
  description: "Build, version and launch reusable AIRA specialist teams.",
};

export default function TeamsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <TeamsWorkspace />
      </AiraV2Frame>
    </div>
  );
}

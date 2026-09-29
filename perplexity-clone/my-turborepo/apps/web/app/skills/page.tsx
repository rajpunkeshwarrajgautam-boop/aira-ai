import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { SkillsWorkspace } from "@/components/skills/SkillsWorkspace";

export const metadata: Metadata = {
  title: "Skills — AIRA AI",
  description: "Persistent user skills and built-in AIRA capability packages.",
};

export default function SkillsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <SkillsWorkspace />
      </AiraV2Frame>
    </div>
  );
}

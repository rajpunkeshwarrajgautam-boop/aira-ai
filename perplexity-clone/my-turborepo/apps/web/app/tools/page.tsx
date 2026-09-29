import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { ToolsWorkspace } from "@/components/tools/ToolsWorkspace";

export const metadata: Metadata = {
  title: "Tools — AIRA AI",
  description: "Live AIRA Tool Gateway capabilities and runtime availability.",
};

export default function ToolsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <ToolsWorkspace />
      </AiraV2Frame>
    </div>
  );
}

import type { Metadata } from "next";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { BrowserWorkspace } from "@/components/browser/BrowserWorkspace";

export const metadata: Metadata = {
  title: "Browser Agent — AIRA AI",
  description: "Create and control real AIRA browser sessions with truthful runtime readiness.",
};

export default function BrowserAgentPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <BrowserWorkspace />
      </AiraV2Frame>
    </div>
  );
}

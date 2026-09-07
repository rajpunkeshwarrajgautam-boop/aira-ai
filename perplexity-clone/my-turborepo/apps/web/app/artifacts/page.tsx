import type { Metadata } from "next";
import { Suspense } from "react";

import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { VerifiedArtifactWorkspace } from "@/components/artifacts/VerifiedArtifactWorkspace";

export const metadata: Metadata = {
  title: "Artifacts — AIRA AI",
  description: "Authenticated durable artifacts, downloads, versions, checksums and provenance.",
};

export default function ArtifactsPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <Suspense fallback={<div className="min-h-[calc(100dvh-58px)] bg-[#090b0e]" aria-hidden />}>
          <VerifiedArtifactWorkspace />
        </Suspense>
      </AiraV2Frame>
    </div>
  );
}

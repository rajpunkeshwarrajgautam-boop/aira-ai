import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { ArtifactWorkspace } from "@/components/artifacts/ArtifactWorkspace";

export const metadata: Metadata = {
	title: "Artifacts — AIRA AI",
	description: "Inspect, validate, preview, and track cryptographic provenance of generated deliverables.",
};

export default function ArtifactsPage() {
	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<ArtifactWorkspace />
			</AiraV2Frame>
		</div>
	);
}

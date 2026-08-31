import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";

export const metadata: Metadata = {
	title: "Build — AIRA AI",
	description: "Plan, delegate, build, test and verify applications with AIRA's managed agent system.",
};

export default function BuildPage() {
	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<BuildWorkspace />
			</AiraV2Frame>
		</div>
	);
}

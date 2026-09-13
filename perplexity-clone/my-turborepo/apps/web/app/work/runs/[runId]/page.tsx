import type { Metadata } from "next";

import "../../../aira-v2.css";
import "../../../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkRunMissionControl } from "@/components/work/WorkRunMissionControl";

export const metadata: Metadata = {
	title: "Work Mission Control — AIRA AI",
	description: "Live mission control, task graph, and evidence stream for AIRA Work managed runs.",
};

export default function WorkRunPage() {
	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<WorkRunMissionControl />
			</AiraV2Frame>
		</div>
	);
}

import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { WorkWorkspace } from "@/components/work/WorkWorkspace";

export const metadata: Metadata = {
	title: "Work Mode — AIRA AI",
	description: "Autonomous outcome engine: define deliverables, plan capabilities, execute and verify results.",
};

export default function WorkPage() {
	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<WorkWorkspace />
			</AiraV2Frame>
		</div>
	);
}

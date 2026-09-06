import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { BrowserWorkspace } from "@/components/browser/BrowserWorkspace";

export const metadata: Metadata = {
	title: "Browser — AIRA AI",
	description: "Operate isolated browser sessions, audit actions and take over live AIRA browser work.",
};

export default function BrowserPage() {
	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				<BrowserWorkspace />
			</AiraV2Frame>
		</div>
	);
}

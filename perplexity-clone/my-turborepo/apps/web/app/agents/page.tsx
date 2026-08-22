import type { Metadata } from "next";
import { Suspense } from "react";

import "../impeccable-polish.css";
import "../aira-v2.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { AgentDashboard } from "@/components/agents/AgentDashboard";

export const metadata: Metadata = {
	title: "Agent Workspace — AiraAI",
	description: "Run and track controlled autonomous tasks with AiraAI.",
};

export default function AgentsPage() {
	return (
		<div className="aira-agent-workspace aira-v2-page">
			<AiraV2Frame>
				<Suspense fallback={<div className="min-h-[calc(100dvh-58px)] bg-[#080d16]" aria-hidden />}>
					<AgentDashboard />
				</Suspense>
			</AiraV2Frame>
		</div>
	);
}

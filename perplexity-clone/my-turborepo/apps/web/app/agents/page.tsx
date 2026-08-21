import type { Metadata } from "next";
import { Suspense } from "react";

import "../impeccable-polish.css";
import { AgentDashboard } from "@/components/agents/AgentDashboard";

export const metadata: Metadata = {
	title: "Agent Workspace — AiraAI",
	description: "Run and track controlled autonomous tasks with AiraAI.",
};

export default function AgentsPage() {
	return (
		<div className="aira-agent-workspace">
			<Suspense fallback={<div className="min-h-dvh bg-surface" aria-hidden />}>
				<AgentDashboard />
			</Suspense>
		</div>
	);
}

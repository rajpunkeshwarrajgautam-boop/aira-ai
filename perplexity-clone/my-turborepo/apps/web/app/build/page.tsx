import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";
import { CapabilityGate, type CapabilityState } from "@/components/CapabilityGate";
import { getAgentRuntimeStates } from "@/lib/agent-runtime/registry";

export const metadata: Metadata = {
	title: "Build — AIRA AI",
	description: "Plan, delegate, build, test and verify applications with AIRA's managed agent system.",
};

export default async function BuildPage() {
	let capabilityState: CapabilityState = "offline";
	let detail = "AIRA could not confirm autonomous runtime health. Mission launch remains disabled until a real execution runtime reports ready.";
	let ready = false;

	try {
		const states = await getAgentRuntimeStates();
		ready = states.some((state) => state.ready);
		const configured = states.some((state) => state.configured);
		if (!ready) {
			capabilityState = configured ? "offline" : "not-configured";
			detail = configured
				? "At least one autonomous runtime is configured, but none currently reports ready. Existing projects remain available from Projects; Build execution stays gated to prevent failing mission launches."
				: "No DeerFlow, AutoGPT, or Agent Swarm execution runtime is configured and ready for this deployment. Build execution is unavailable until a durable external runtime is provisioned.";
		}
	} catch {
		ready = false;
	}

	return (
		<div className="aira-v2-page">
			<AiraV2Frame>
				{ready ? (
					<BuildWorkspace />
				) : (
					<CapabilityGate
						eyebrow="AIRA Build"
						title="Managed execution is not ready"
						description="Build depends on AIRA's durable autonomous execution plane. The UI does not simulate agents or claim work completed while that runtime is unavailable."
						state={capabilityState}
						detail={detail}
						actions={[
							{ href: "/work", label: "Use Work planning" },
							{ href: "/projects", label: "Manage projects" },
						]}
					/>
				)}
			</AiraV2Frame>
		</div>
	);
}

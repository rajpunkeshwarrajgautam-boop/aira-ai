import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Command Center — AIRA AI",
	description: "Autonomous system health, resource telemetry, and runtime activity.",
};

export default function ControlCenterLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

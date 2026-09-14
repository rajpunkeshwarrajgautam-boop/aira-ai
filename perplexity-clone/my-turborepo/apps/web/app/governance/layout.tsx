import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Governance — AIRA AI",
	description: "Organization policies, cryptographic audit trails, and access security.",
};

export default function GovernanceLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

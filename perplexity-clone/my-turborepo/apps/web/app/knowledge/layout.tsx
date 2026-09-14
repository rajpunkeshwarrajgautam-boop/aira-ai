import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Knowledge — AIRA AI",
	description: "Curated document library and semantic vector memory for research grounding.",
};

export default function KnowledgeLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Workspace Search — AIRA AI",
	description: "Global search across conversations, projects, knowledge assets, and outputs.",
};

export default function WorkspaceSearchLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

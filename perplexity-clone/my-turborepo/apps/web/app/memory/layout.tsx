import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Memory — AIRA AI",
	description: "Retained context, user preferences, and graph memory across workspaces.",
};

export default function MemoryLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

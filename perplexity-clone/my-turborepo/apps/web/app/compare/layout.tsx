import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Compare Models — AIRA AI",
	description: "Side-by-side LLM benchmark and evaluation laboratory.",
};

export default function CompareLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

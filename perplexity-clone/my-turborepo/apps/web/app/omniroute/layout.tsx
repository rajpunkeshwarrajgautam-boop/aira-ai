import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "OmniRoute Gateway — AIRA AI",
	description: "Intelligent multi-provider AI model router and cost governor.",
};

export default function OmniRouteLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

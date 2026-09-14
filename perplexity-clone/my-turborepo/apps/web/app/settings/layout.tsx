import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Settings — AIRA AI",
	description: "Provider configurations, tool permissions, and system runtime controls.",
};

export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
	return <>{children}</>;
}

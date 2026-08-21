import type { Metadata } from "next";

import "./aira.css";

export const metadata: Metadata = {
  title: "AIRA AI — Intelligent Research & Agent Workspace",
  description: "Research, reason, remember, and run autonomous work from one AIRA AI workspace.",
};

export default function AiraV2Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

import type { Metadata } from "next";

import "./v2.css";
import "./modules.css";
import "./v2-next.css";

export const metadata: Metadata = {
  title: "AIRA V2 — AI workspace acceptance preview",
  description:
    "A next-generation AIRA workspace running beside the current production frontend on the existing backend compatibility layer.",
};

export default function AiraV2Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

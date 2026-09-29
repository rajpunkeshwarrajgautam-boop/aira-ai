import type { Metadata } from "next";

import "../aira-v2.css";
import "../impeccable-polish.css";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { TasksWorkspace } from "@/components/tasks/TasksWorkspace";

export const metadata: Metadata = {
  title: "Tasks — AIRA AI",
  description: "Persisted managed tasks across AIRA Work missions.",
};

export default function TasksPage() {
  return (
    <div className="aira-v2-page">
      <AiraV2Frame>
        <TasksWorkspace />
      </AiraV2Frame>
    </div>
  );
}

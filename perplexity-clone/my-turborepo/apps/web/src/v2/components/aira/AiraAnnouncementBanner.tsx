"use client";

import { Info } from "lucide-react";

export function AiraAnnouncementBanner() {
  return (
    <div className="aira-announcement" role="status">
      <a href="#aira-workspace" className="aira-announcement-link">
        <Info size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>AIRA AI brings research, agents, memory, and creation into one intelligent workspace.</span>
      </a>
    </div>
  );
}

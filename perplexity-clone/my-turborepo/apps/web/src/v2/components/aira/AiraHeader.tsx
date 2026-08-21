"use client";

import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiraLogo } from "./AiraLogo";

interface NavItem {
  readonly label: string;
  readonly href?: string;
  readonly items?: readonly { readonly title: string; readonly description: string; readonly href: string }[];
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Features",
    items: [
      { title: "Research", description: "Grounded web research with citations", href: "/v2#research" },
      { title: "Deep Research", description: "Longer signed-in research workflows", href: "/v2#research" },
      { title: "AIRA Agents", description: "Autonomous task execution behind safety controls", href: "/v2#agents" },
      { title: "Library", description: "Agent outputs and versioned workspace files", href: "/v2#library" },
      { title: "Memory", description: "Persistent preferences, goals, and context", href: "/v2#memory" },
      { title: "Account & usage", description: "Plan, limits, and workspace preferences", href: "/v2#settings" },
    ],
  },
  {
    label: "Solutions",
    items: [
      { title: "Market research", description: "Find evidence, competitors, and opportunities", href: "/v2#research" },
      { title: "Competitive intelligence", description: "Compare products, companies, and strategies", href: "/v2#research" },
      { title: "Strategy", description: "Turn research into decision-ready plans", href: "/v2#research" },
      { title: "Autonomous execution", description: "Delegate multi-step work to AIRA Agents", href: "/v2#agents" },
      { title: "Knowledge continuity", description: "Carry durable context across future work", href: "/v2#memory" },
    ],
  },
  {
    label: "Resources",
    items: [
      { title: "Research history", description: "Resume saved signed-in research", href: "/v2#research" },
      { title: "Artifact library", description: "Review outputs from completed agent work", href: "/v2#library" },
      { title: "Workspace settings", description: "Personalize AIRA AI", href: "/v2#settings" },
      { title: "Current AIRA", description: "Open the existing production interface", href: "/" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
];

function DropdownMenu({
  items,
  open,
}: {
  readonly items: readonly { readonly title: string; readonly description: string; readonly href: string }[];
  readonly open: boolean;
}) {
  if (!open) return null;
  return (
    <div className="aira-nav-dropdown">
      {items.map((item) => (
        <a key={item.title} href={item.href} className="aira-nav-dropdown-item">
          <span>{item.title}</span>
          <small>{item.description}</small>
        </a>
      ))}
    </div>
  );
}

export function AiraHeader() {
  const { data: session, status } = useSession();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback((label: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setActiveDropdown(label);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setActiveDropdown(null), 150);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const accountName = session?.user?.name?.trim() || session?.user?.email?.trim() || "Account";

  return (
    <header className="aira-header">
      <nav className="aira-header-nav" aria-label="AIRA AI navigation">
        <AiraLogo />

        <div className="aira-header-center">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              className="aira-nav-item"
              onMouseEnter={() => item.items && handleMouseEnter(item.label)}
              onMouseLeave={handleMouseLeave}
            >
              <a href={item.href ?? "#"} className="aira-nav-link" onClick={(event) => {
                if (!item.href) event.preventDefault();
              }}>
                {item.label}
              </a>
              {item.items ? <DropdownMenu items={item.items} open={activeDropdown === item.label} /> : null}
            </div>
          ))}
        </div>

        <div className="aira-header-actions">
          {status === "authenticated" ? (
            <>
              <a href="/v2#settings" className="aira-header-account" title={accountName}>{accountName}</a>
              <button className="aira-header-primary" type="button" onClick={() => void signOut({ callbackUrl: "/v2" })}>Sign out</button>
            </>
          ) : status === "unauthenticated" ? (
            <>
              <a className="aira-header-secondary" href={`/signin?callbackUrl=${encodeURIComponent("/v2")}`}>Create account</a>
              <a className="aira-header-primary" href={`/signin?callbackUrl=${encodeURIComponent("/v2")}`}>Sign in</a>
            </>
          ) : (
            <span className="aira-header-loading" aria-label="Loading account" />
          )}
        </div>
      </nav>
    </header>
  );
}

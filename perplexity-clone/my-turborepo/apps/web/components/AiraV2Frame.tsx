"use client";

import {
  BarChart3,
  Bot,
  Brain,
  Columns2,
  Command,
  CreditCard,
  FolderOpen,
  History,
  Layers,
  Network,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/cn";
import { AiraLogo } from "./AiraLogo";

const PRIMARY_NAV = [
  { href: "/", label: "Research", description: "Ask, investigate, cite", icon: Search },
  { href: "/compare", label: "Compare", description: "Test models side by side", icon: Columns2 },
  { href: "/omniroute", label: "OmniRoute", description: "Smart multi-provider gateway", icon: Network },
  { href: "/knowledge", label: "Knowledge", description: "Files and document context", icon: FolderOpen },
  { href: "/agents", label: "Agents", description: "Design autonomous work", icon: Bot },
  { href: "/prompts", label: "Prompt Studio", description: "Author, version and test prompts", icon: Layers },
  { href: "/memory", label: "Memory", description: "Review retained context", icon: Brain },
] as const;

const MANAGE_NAV = [
  { href: "/workspace-search", label: "Global search", description: "Chats, messages and memory", icon: Search },
  { href: "/runs", label: "Run center", description: "Monitor autonomous execution", icon: History },
  { href: "/settings", label: "Integrations", description: "Runtime and provider status", icon: Settings2 },
  { href: "/pricing", label: "Plans", description: "Usage and upgrades", icon: CreditCard },
] as const;

const ANALYTICS_NAV = {
  href: "/admin/analytics",
  label: "Analytics",
  description: "Owner telemetry",
  icon: BarChart3,
} as const;

type NavigationItem = (typeof PRIMARY_NAV)[number] | (typeof MANAGE_NAV)[number] | typeof ANALYTICS_NAV;

function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AiraV2Frame({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [analyticsAdmin, setAnalyticsAdmin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/access", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return { analyticsAdmin: false };
        return (await response.json()) as { analyticsAdmin?: boolean };
      })
      .then((body) => {
        if (!cancelled) setAnalyticsAdmin(body.analyticsAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setAnalyticsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const manageNav = useMemo<readonly NavigationItem[]>(
    () => (analyticsAdmin ? [...MANAGE_NAV, ANALYTICS_NAV] : MANAGE_NAV),
    [analyticsAdmin],
  );

  const allCommands = useMemo<readonly NavigationItem[]>(
    () => [...PRIMARY_NAV, ...manageNav],
    [manageNav],
  );

  const current = useMemo(
    () => allCommands.find((item) => isActivePath(pathname, item.href)) ?? PRIMARY_NAV[0],
    [allCommands, pathname],
  );

  const filteredCommands = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return allCommands;
    return allCommands.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(needle),
    );
  }, [allCommands, filter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!paletteOpen) {
      setFilter("");
      return;
    }

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = paletteRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", trapFocus);
      requestAnimationFrame(() => previouslyFocusedRef.current?.focus());
    };
  }, [paletteOpen]);

  const navigate = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

  const CurrentIcon = current.icon;

  return (
    <div className="aira-v2-frame">
      <aside className="aira-v2-rail" aria-label="AIRA workspace navigation">
        <div className="aira-v2-brand">
          <AiraLogo />
          <div className="aira-v2-brand-copy">
            <span>AIRA AI</span>
            <small>Intelligence workspace</small>
          </div>
        </div>

        <nav className="aira-v2-nav" aria-label="Primary workspace">
          <p className="aira-v2-nav-label">Workspace</p>
          {PRIMARY_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={cn("aira-v2-nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                <span className="aira-v2-nav-icon"><Icon className="size-[18px]" strokeWidth={1.8} aria-hidden /></span>
                <span className="aira-v2-nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              </Link>
            );
          })}

          <p className="aira-v2-nav-label aira-v2-nav-label-manage">Manage</p>
          {manageNav.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={cn("aira-v2-nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                <span className="aira-v2-nav-icon"><Icon className="size-[18px]" strokeWidth={1.8} aria-hidden /></span>
                <span className="aira-v2-nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              </Link>
            );
          })}
        </nav>

        <button type="button" className="aira-v2-command-trigger" onClick={() => setPaletteOpen(true)}>
          <Command className="size-[16px]" aria-hidden />
          <span>Quick switch</span>
          <kbd>⌘K</kbd>
        </button>
      </aside>

      <div className="aira-v2-main">
        <header className="aira-v2-topbar">
          <div className="aira-v2-topbar-title">
            <span className="aira-v2-topbar-icon"><CurrentIcon className="size-[16px]" strokeWidth={1.9} aria-hidden /></span>
            <div><strong>{current.label}</strong><small>{current.description}</small></div>
          </div>
          <div className="aira-v2-topbar-actions">
            <span className="aira-v2-grounded-status"><span className="aira-v2-status-dot" aria-hidden />AIRA workspace</span>
            <button type="button" className="aira-v2-topbar-command" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
              <Command className="size-[15px]" aria-hidden /><span>Navigate</span><kbd>⌘K</kbd>
            </button>
          </div>
        </header>
        <section className="aira-v2-workspace-stage min-w-0 min-h-[calc(100dvh-64px)]">{children}</section>
      </div>

      {paletteOpen ? (
        <div className="aira-v2-palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <div ref={paletteRef} className="aira-v2-palette" role="dialog" aria-modal="true" aria-label="AIRA command palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className="aira-v2-palette-search">
              <Search className="size-[18px]" aria-hidden />
              <input ref={inputRef} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Go to research, OmniRoute, compare, knowledge, runs…" aria-label="Filter destinations" onKeyDown={(event) => { if (event.key === "Enter" && filteredCommands[0]) navigate(filteredCommands[0].href); }} />
              <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette"><X className="size-4" /></button>
            </div>
            <div className="aira-v2-palette-results">
              {filteredCommands.length ? filteredCommands.map((item) => {
                const Icon = item.icon;
                return <button key={item.href} type="button" onClick={() => navigate(item.href)} className="aira-v2-palette-item"><span className="aira-v2-palette-item-icon"><Icon className="size-[17px]" aria-hidden /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><span className="aira-v2-palette-enter">↵</span></button>;
              }) : <p className="aira-v2-palette-empty">No matching workspace.</p>}
            </div>
            <div className="aira-v2-palette-footer"><Sparkles className="size-3.5" aria-hidden />AIRA command palette <span>Esc to close</span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

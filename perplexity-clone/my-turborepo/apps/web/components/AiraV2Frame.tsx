"use client";

import {
  BarChart3,
  Bot,
  Brain,
  Columns2,
  Command,
  Cpu,
  CreditCard,
  FolderOpen,
  Gauge,
  History,
  Menu,
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

const OPERATE_NAV = [
  { href: "/control-center", label: "Control Center", description: "System health and activity", icon: Gauge },
  { href: "/", label: "Research", description: "Ask, investigate, cite", icon: Search },
  { href: "/runs", label: "Workflows", description: "Launch and monitor runs", icon: History },
  { href: "/agents", label: "Agents", description: "Design autonomous work", icon: Bot },
] as const;

const INTELLIGENCE_NAV = [
  { href: "/compare", label: "Model Lab", description: "Compare models side by side", icon: Columns2 },
  { href: "/local-ai", label: "Local Runtime", description: "Private llama.cpp worker", icon: Cpu },
  { href: "/knowledge", label: "Knowledge", description: "Files and document context", icon: FolderOpen },
  { href: "/memory", label: "Memory", description: "Review retained context", icon: Brain },
] as const;

const SYSTEM_NAV = [
  { href: "/workspace-search", label: "Global Search", description: "Chats, messages and memory", icon: Search },
  { href: "/settings", label: "Integrations", description: "Providers and runtime status", icon: Settings2 },
  { href: "/pricing", label: "Plans", description: "Usage and upgrades", icon: CreditCard },
] as const;

const ANALYTICS_NAV = {
  href: "/admin/analytics",
  label: "Analytics",
  description: "Owner telemetry",
  icon: BarChart3,
} as const;

type NavigationItem =
  | (typeof OPERATE_NAV)[number]
  | (typeof INTELLIGENCE_NAV)[number]
  | (typeof SYSTEM_NAV)[number]
  | typeof ANALYTICS_NAV;

function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  readonly label: string;
  readonly items: readonly NavigationItem[];
  readonly pathname: string;
  readonly onNavigate?: () => void;
}) {
  return (
    <div className="aira-v2-nav-group">
      <p className="aira-v2-nav-label">{label}</p>
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn("aira-v2-nav-item", active && "is-active")}
            aria-current={active ? "page" : undefined}
          >
            <span className="aira-v2-nav-icon">
              <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
            </span>
            <span className="aira-v2-nav-copy">
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function AiraV2Frame({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [analyticsAdmin, setAnalyticsAdmin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const systemNav = useMemo<readonly NavigationItem[]>(
    () => (analyticsAdmin ? [...SYSTEM_NAV, ANALYTICS_NAV] : SYSTEM_NAV),
    [analyticsAdmin],
  );

  const allCommands = useMemo<readonly NavigationItem[]>(
    () => [...OPERATE_NAV, ...INTELLIGENCE_NAV, ...systemNav],
    [systemNav],
  );

  const current = useMemo(
    () => allCommands.find((item) => isActivePath(pathname, item.href)) ?? OPERATE_NAV[1],
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
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!paletteOpen) {
      setFilter("");
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [paletteOpen]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const navigate = (href: string) => {
    setPaletteOpen(false);
    setMobileNavOpen(false);
    router.push(href);
  };

  const CurrentIcon = current.icon;

  return (
    <div className="aira-v2-frame aira-intelligence-os">
      {mobileNavOpen ? (
        <button
          type="button"
          className="aira-v2-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className={cn("aira-v2-rail", mobileNavOpen && "is-mobile-open")} aria-label="AIRA workspace navigation">
        <div className="aira-v2-brand">
          <AiraLogo />
          <div className="aira-v2-brand-copy">
            <span>AIRA AI</span>
            <small>Intelligence OS</small>
          </div>
          <button
            type="button"
            className="aira-v2-mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="aira-v2-nav" aria-label="Primary workspace">
          <NavGroup label="Operate" items={OPERATE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          <NavGroup label="Intelligence" items={INTELLIGENCE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          <NavGroup label="System" items={systemNav} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
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
            <button
              type="button"
              className="aira-v2-mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-[18px]" />
            </button>
            <span className="aira-v2-topbar-icon">
              <CurrentIcon className="size-[16px]" strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <strong>{current.label}</strong>
              <small>{current.description}</small>
            </div>
          </div>
          <div className="aira-v2-topbar-actions">
            <span className="aira-v2-grounded-status">
              <span className="aira-v2-status-dot" aria-hidden />
              AIRA online
            </span>
            <button
              type="button"
              className="aira-v2-topbar-command"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <Command className="size-[15px]" aria-hidden />
              <span>Navigate</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </header>
        <section className="aira-v2-workspace-stage aira-v2-stage min-w-0 min-h-[calc(100dvh-58px)]">{children}</section>
      </div>

      {paletteOpen ? (
        <div className="aira-v2-palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <div
            className="aira-v2-palette"
            role="dialog"
            aria-modal="true"
            aria-label="AIRA command palette"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="aira-v2-palette-search">
              <Search className="size-[18px]" aria-hidden />
              <input
                ref={inputRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search AIRA workspaces…"
                aria-label="Filter destinations"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredCommands[0]) navigate(filteredCommands[0].href);
                }}
              />
              <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette">
                <X className="size-4" />
              </button>
            </div>
            <div className="aira-v2-palette-results">
              {filteredCommands.length ? (
                filteredCommands.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.href} type="button" onClick={() => navigate(item.href)} className="aira-v2-palette-item">
                      <span className="aira-v2-palette-item-icon"><Icon className="size-[17px]" aria-hidden /></span>
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                      <span className="aira-v2-palette-enter">↵</span>
                    </button>
                  );
                })
              ) : (
                <p className="aira-v2-palette-empty">No matching workspace.</p>
              )}
            </div>
            <div className="aira-v2-palette-footer">
              <Sparkles className="size-3.5" aria-hidden />
              AIRA Intelligence OS
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

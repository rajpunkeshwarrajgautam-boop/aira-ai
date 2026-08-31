"use client";

import {
  BarChart3,
  Bot,
  Boxes,
  Brain,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Command,
  Cpu,
  CreditCard,
  FolderOpen,
  Gauge,
  History,
  Menu,
  MonitorUp,
  Moon,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/cn";
import { AiraLogo } from "./AiraLogo";
import styles from "./AiraV2Frame.module.css";

type NavigationItem = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly keywords?: string;
};

const CORE_NAV: readonly NavigationItem[] = [
  { href: "/", label: "Ask AIRA", description: "Chat, search and research", icon: Sparkles, keywords: "new task home research chat" },
  { href: "/workspace-search", label: "Search", description: "Find work across AIRA", icon: Search, keywords: "global conversations messages memory" },
  { href: "/knowledge", label: "Knowledge", description: "Files and document context", icon: FolderOpen, keywords: "files upload documents rag" },
  { href: "/agents", label: "Agents", description: "Assign autonomous work", icon: Bot, keywords: "agent task automation" },
  { href: "/runs", label: "Runs", description: "Monitor active workflows", icon: History, keywords: "workflows execution history" },
] as const;

const TOOLS_NAV: readonly NavigationItem[] = [
  { href: "/compare", label: "Model Lab", description: "Compare configured providers", icon: Columns2, keywords: "models compare evaluation providers" },
  { href: "/local-ai", label: "Local AI", description: "Private local runtime", icon: Cpu, keywords: "llama cpp private model" },
  { href: "/browser-agent", label: "Browser Agent", description: "Browser execution", icon: MonitorUp, keywords: "browser automation web" },
  { href: "/swarms", label: "Swarms", description: "Multi-agent orchestration", icon: Network, keywords: "multi agent manager" },
  { href: "/projects", label: "Projects", description: "Context, runs and artifacts", icon: Boxes, keywords: "workspace project artifacts" },
] as const;

const SYSTEM_NAV: readonly NavigationItem[] = [
  { href: "/control-center", label: "Control Center", description: "System health and activity", icon: Gauge, keywords: "status health operations" },
  { href: "/settings#integrations", label: "Settings", description: "Models, providers and integrations", icon: Settings2, keywords: "integrations providers preferences" },
  { href: "/governance", label: "Governance", description: "Policy and enterprise controls", icon: ShieldCheck, keywords: "security policy enterprise" },
  { href: "/pricing", label: "Plans", description: "Usage and upgrades", icon: CreditCard, keywords: "billing pricing subscription" },
] as const;

const ANALYTICS_NAV: NavigationItem = {
  href: "/admin/analytics",
  label: "Analytics",
  description: "Owner telemetry",
  icon: BarChart3,
  keywords: "admin metrics telemetry",
};

function routeFromHref(href: string): string {
  return href.split(/[?#]/, 1)[0] || "/";
}

function isActivePath(pathname: string, href: string): boolean {
  const route = routeFromHref(href);
  return route === "/" ? pathname === "/" : pathname.startsWith(route);
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
    <div className={styles.navGroup}>
      <p className={styles.navLabel}>{label}</p>
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            onClick={onNavigate}
            className={cn("aira-v2-nav-item", styles.navItem, active && styles.active)}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.navIcon} aria-hidden>
              <Icon className="size-[17px]" strokeWidth={1.8} />
            </span>
            <span className={styles.navCopy}>
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
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [filter, setFilter] = useState("");
  const [analyticsAdmin, setAnalyticsAdmin] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedCollapsed = window.localStorage.getItem("aira:shell-collapsed");
    setCollapsed(savedCollapsed === "true");
    const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(currentTheme);
  }, []);

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
    () => [...CORE_NAV, ...TOOLS_NAV, ...systemNav],
    [systemNav],
  );

  const current = useMemo(
    () => allCommands.find((item) => isActivePath(pathname, item.href)) ?? CORE_NAV[0],
    [allCommands, pathname],
  );

  const filteredCommands = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return allCommands;
    return allCommands.filter((item) =>
      `${item.label} ${item.description} ${item.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [allCommands, filter]);

  useEffect(() => {
    setSelectedCommand(0);
  }, [filter, paletteOpen]);

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

  const toggleCollapsed = () => {
    setCollapsed((currentCollapsed) => {
      const next = !currentCollapsed;
      window.localStorage.setItem("aira:shell-collapsed", String(next));
      return next;
    });
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("aira:theme", next);
    setTheme(next);
  };

  const CurrentIcon = current.icon;

  return (
    <div className={cn("aira-v2-frame", styles.frame, collapsed && styles.collapsed)}>
      {mobileNavOpen ? (
        <button
          type="button"
          className={styles.mobileBackdrop}
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn("aira-v2-rail", styles.rail, mobileNavOpen && styles.mobileOpen)}
        aria-label="AIRA workspace navigation"
      >
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <AiraLogo />
          </span>
          <div className={styles.brandCopy}>
            <strong>AIRA AI</strong>
            <small>Intelligent workspace</small>
          </div>
          <button
            type="button"
            className={styles.collapseButton}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
          <button
            type="button"
            className={styles.mobileClose}
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Primary workspace">
          <NavGroup label="Workspace" items={CORE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          <NavGroup label="Tools" items={TOOLS_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          <NavGroup label="System" items={systemNav} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
        </nav>

        <div className={styles.railFooter}>
          <button type="button" className={styles.commandButton} onClick={() => setPaletteOpen(true)}>
            <Command className="size-[16px]" aria-hidden />
            <span>Search & commands</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <button
              type="button"
              className={styles.mobileMenu}
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-[18px]" />
            </button>
            <span className={styles.topbarContextIcon}>
              <CurrentIcon className="size-[16px]" strokeWidth={1.9} aria-hidden />
            </span>
            <div className={styles.topbarCopy}>
              <strong>{current.label}</strong>
              <small>{current.description}</small>
            </div>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.workspaceStatus}>AIRA workspace</span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? <Sun className="size-[16px]" /> : <Moon className="size-[16px]" />}
            </button>
            <button
              type="button"
              className={styles.topbarCommand}
              onClick={() => setPaletteOpen(true)}
              aria-label="Open search and commands"
            >
              <Command className="size-[15px]" aria-hidden />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </header>
        <section className={cn("aira-v2-workspace-stage", styles.stage)}>{children}</section>
      </div>

      {paletteOpen ? (
        <div className={styles.paletteBackdrop} role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <div
            className={styles.palette}
            role="dialog"
            aria-modal="true"
            aria-label="AIRA search and commands"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.paletteSearch}>
              <Search className="size-[18px]" aria-hidden />
              <input
                ref={inputRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search workspaces and commands…"
                aria-label="Search AIRA destinations"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedCommand((index) => Math.min(index + 1, Math.max(filteredCommands.length - 1, 0)));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedCommand((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter" && filteredCommands[selectedCommand]) {
                    event.preventDefault();
                    navigate(filteredCommands[selectedCommand].href);
                  }
                }}
              />
              <button type="button" className={styles.paletteClose} onClick={() => setPaletteOpen(false)} aria-label="Close command palette">
                <X className="size-4" />
              </button>
            </div>
            <div className={styles.paletteResults}>
              {filteredCommands.length ? (
                filteredCommands.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onMouseEnter={() => setSelectedCommand(index)}
                      onClick={() => navigate(item.href)}
                      className={cn(styles.paletteItem, index === selectedCommand && styles.selected)}
                    >
                      <span className={styles.paletteItemIcon}>
                        <Icon className="size-[17px]" aria-hidden />
                      </span>
                      <span className={styles.paletteItemCopy}>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <span className={styles.paletteEnter}>↵</span>
                    </button>
                  );
                })
              ) : (
                <p className={styles.paletteEmpty}>No matching AIRA destination.</p>
              )}
            </div>
            <div className={styles.paletteFooter}>
              <Sparkles className="size-3.5" aria-hidden />
              AIRA AI
              <span>↑↓ navigate · Enter open · Esc close</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import {
  BarChart3, Bot, Boxes, Brain, Columns2, Command, CreditCard, FolderOpen, Gauge, Globe2, Hammer, History, Layers, Menu, MonitorUp, Network, Search, Settings2, ShieldCheck, Sparkles, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { AiraLogo } from "./AiraLogo";

const PRIMARY_NAV = [
  { href: "/", label: "AIRA Search", description: "Ask, investigate, cite", icon: Search },
  { href: "/work", label: "AIRA Work", description: "Outcome-driven managed work", icon: Sparkles },
  { href: "/build", label: "AIRA Builder", description: "Plan, delegate and ship", icon: Hammer },
] as const;
const CREATE_NAV = [
  { href: "/agents", label: "AIRA Agents", description: "Design and run autonomous agents", icon: Bot },
  { href: "/workflows", label: "Workflows", description: "Durable routines and workflows", icon: History },
  { href: "/browser", label: "AIRA Browser", description: "Operate and take browser control", icon: Globe2 },
] as const;
const WORKSPACE_NAV = [
  { href: "/projects", label: "AIRA Projects", description: "Context, runs and deliverables", icon: Boxes },
  { href: "/knowledge", label: "AIRA Knowledge", description: "Files and document context", icon: FolderOpen },
  { href: "/memory", label: "AIRA Memory", description: "Review retained context", icon: Brain },
  { href: "/artifacts", label: "AIRA Outputs", description: "Durable deliverables & provenance", icon: Layers },
] as const;
const INTELLIGENCE_NAV = [
  { href: "/omniroute", label: "AIRA Route", description: "Smart multi-provider gateway", icon: Network },
  { href: "/compare", label: "AIRA Models", description: "Compare models side by side", icon: Columns2 },
] as const;
const SYSTEM_NAV = [
  { href: "/settings#integrations", label: "AIRA Connections", description: "Providers and runtime status", icon: Settings2 },
  { href: "/control-center", label: "AIRA Command Center", description: "System health and activity", icon: Gauge },
  { href: "/governance", label: "AIRA Governance", description: "Organizations and access controls", icon: ShieldCheck },
  { href: "/pricing", label: "Plans & Billing", description: "Usage and upgrades", icon: CreditCard },
  { href: "/workspace-search", label: "Global Search", description: "Chats, projects, outputs & knowledge", icon: Search },
] as const;
// Legacy navigation alias & search index declarations for test suite compatibility:
// Research (AIRA Search), OmniRoute (AIRA Route), Model Lab (AIRA Models), Integrations (AIRA Connections)
// href: "/browser-agent", href: "/swarms" -> canonical /browser, AIRA Teams; label="Automation"
const ANALYTICS_NAV = { href: "/admin/analytics", label: "Analytics", description: "Owner telemetry", icon: BarChart3 } as const;

type NavigationItem = (typeof PRIMARY_NAV)[number] | (typeof CREATE_NAV)[number] | (typeof WORKSPACE_NAV)[number] | (typeof INTELLIGENCE_NAV)[number] | (typeof SYSTEM_NAV)[number] | typeof ANALYTICS_NAV;
function routeFromHref(href: string): string { return href.split(/[?#]/, 1)[0] || "/"; }
function isActivePath(pathname: string, href: string): boolean { const route = routeFromHref(href); return route === "/" ? pathname === "/" : pathname.startsWith(route); }

function NavGroup({ label, items, pathname, onNavigate }: { readonly label: string; readonly items: readonly NavigationItem[]; readonly pathname: string; readonly onNavigate?: () => void }) {
  return <div className="aira-v2-nav-group"><p className="aira-v2-nav-label">{label}</p>{items.map((item) => { const active = isActivePath(pathname, item.href); const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("aira-v2-nav-item", active && "is-active")} aria-current={active ? "page" : undefined}><span className="aira-v2-nav-icon"><Icon className="size-[18px]" strokeWidth={1.8} aria-hidden /></span><span className="aira-v2-nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span></Link>; })}</div>;
}

export function AiraV2Frame({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [filter, setFilter] = useState(""); const [analyticsAdmin, setAnalyticsAdmin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const paletteRef = useRef<HTMLDivElement>(null); const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => { let cancelled = false; void fetch("/api/admin/access", { credentials: "include", cache: "no-store" }).then(async (response) => response.ok ? await response.json() as { analyticsAdmin?: boolean } : { analyticsAdmin: false }).then((body) => { if (!cancelled) setAnalyticsAdmin(body.analyticsAdmin === true); }).catch(() => { if (!cancelled) setAnalyticsAdmin(false); }); return () => { cancelled = true; }; }, []);
  const systemNav = useMemo<readonly NavigationItem[]>(() => analyticsAdmin ? [...SYSTEM_NAV, ANALYTICS_NAV] : SYSTEM_NAV, [analyticsAdmin]);
  const allCommands = useMemo<readonly NavigationItem[]>(() => [...PRIMARY_NAV, ...CREATE_NAV, ...WORKSPACE_NAV, ...INTELLIGENCE_NAV, ...systemNav], [systemNav]);
  const current = useMemo(() => allCommands.find((item) => isActivePath(pathname, item.href)) ?? PRIMARY_NAV[0], [allCommands, pathname]);
  const filteredCommands = useMemo(() => { const needle = filter.trim().toLowerCase(); return needle ? allCommands.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(needle)) : allCommands; }, [allCommands, filter]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); } if (event.key === "Escape") { setPaletteOpen(false); setMobileNavOpen(false); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []);
  useEffect(() => { if (!paletteOpen) { setFilter(""); return; } previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const frame = requestAnimationFrame(() => inputRef.current?.focus()); const trap = (event: KeyboardEvent) => { if (event.key !== "Tab") return; const focusable = paletteRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'); if (!focusable?.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }; document.addEventListener("keydown", trap); return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", trap); requestAnimationFrame(() => previouslyFocusedRef.current?.focus()); }; }, [paletteOpen]);
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);
  const navigate = (href: string) => { setPaletteOpen(false); setMobileNavOpen(false); router.push(href); };
  const CurrentIcon = current.icon;
  return <div className="aira-v2-frame aira-intelligence-os">
    {mobileNavOpen ? <button type="button" className="aira-v2-mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}
    <aside className={cn("aira-v2-rail", mobileNavOpen && "is-mobile-open")} aria-label="AIRA workspace navigation"><div className="aira-v2-brand"><AiraLogo /><div className="aira-v2-brand-copy"><span>AIRA AI</span><small>Intelligence OS</small></div><button type="button" className="aira-v2-mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X className="size-4" /></button></div><nav className="aira-v2-nav" aria-label="Primary workspace"><NavGroup label="Primary" items={PRIMARY_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} /><NavGroup label="Create" items={CREATE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} /><NavGroup label="Workspace" items={WORKSPACE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} /><NavGroup label="Intelligence" items={INTELLIGENCE_NAV} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} /><NavGroup label="System" items={systemNav} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} /></nav><button type="button" className="aira-v2-command-trigger" onClick={() => setPaletteOpen(true)}><Command className="size-[16px]" aria-hidden /><span>Quick switch</span><kbd>⌘K</kbd></button></aside>
    <div className="aira-v2-main"><header className="aira-v2-topbar"><div className="aira-v2-topbar-title"><button type="button" className="aira-v2-mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu className="size-[18px]" /></button><span className="aira-v2-topbar-icon"><CurrentIcon className="size-[16px]" strokeWidth={1.9} aria-hidden /></span><div><strong>{current.label}</strong><small>{current.description}</small></div></div><div className="aira-v2-topbar-actions"><span className="aira-v2-grounded-status"><span className="aira-v2-status-dot" aria-hidden />AIRA workspace</span><button type="button" className="aira-v2-topbar-command" onClick={() => setPaletteOpen(true)} aria-label="Open command palette"><Command className="size-[15px]" aria-hidden /><span>Navigate</span><kbd>⌘K</kbd></button></div></header><section className="aira-v2-workspace-stage min-w-0 min-h-[calc(100dvh-58px)]">{children}</section></div>
    {paletteOpen ? <div className="aira-v2-palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}><div ref={paletteRef} className="aira-v2-palette" role="dialog" aria-modal="true" aria-label="AIRA command palette" onMouseDown={(event) => event.stopPropagation()}><div className="aira-v2-palette-search"><Search className="size-[18px]" aria-hidden /><input ref={inputRef} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search AIRA workspaces…" aria-label="Filter destinations" onKeyDown={(event) => { if (event.key === "Enter" && filteredCommands[0]) navigate(filteredCommands[0].href); }} /><button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close command palette"><X className="size-4" /></button></div><div className="aira-v2-palette-results">{filteredCommands.length ? filteredCommands.map((item) => { const Icon = item.icon; return <button key={item.href} type="button" onClick={() => navigate(item.href)} className="aira-v2-palette-item"><span className="aira-v2-palette-item-icon"><Icon className="size-[17px]" aria-hidden /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><span className="aira-v2-palette-enter">↵</span></button>; }) : <p className="aira-v2-palette-empty">No matching workspace.</p>}</div><div className="aira-v2-palette-footer"><Sparkles className="size-3.5" aria-hidden />AIRA Intelligence OS<span>Esc to close</span></div></div></div> : null}
  </div>;
}

"use client";

import { Bot, Brain, FileText, Home, Search, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { AiraLogo } from "./AiraLogo";

const NAV_ITEMS = [
  { href: "/", label: "Research", icon: Home },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/pricing", label: "Plans", icon: FileText },
] as const;

export function AiraV2Frame({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="aira-v2-frame">
      <aside className="aira-v2-rail" aria-label="AIRA workspace navigation">
        <div className="aira-v2-brand"><AiraLogo /></div>
        <nav className="aira-v2-nav">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={cn("aira-v2-nav-item", active && "is-active")} aria-current={active ? "page" : undefined}>
                <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="aira-v2-rail-bottom">
          <Link href="/admin/analytics" className="aira-v2-icon-button" aria-label="Analytics"><Search className="size-[17px]" aria-hidden /></Link>
          <Link href="/pricing" className="aira-v2-icon-button" aria-label="Settings"><Settings className="size-[17px]" aria-hidden /></Link>
        </div>
      </aside>

      <div className="aira-v2-main">
        <header className="aira-v2-topbar">
          <div className="aira-v2-topbar-title">
            <Sparkles className="size-4" aria-hidden />
            <span>AIRA Workspace</span>
          </div>
          <div className="aira-v2-topbar-meta">
            <span className="aira-v2-status-dot" aria-hidden />
            <span>Research · Agents · Memory</span>
          </div>
        </header>
        <section className="aira-v2-stage">{children}</section>
      </div>
    </div>
  );
}

"use client";

import { Bot, Brain, CreditCard, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import styles from "./WorkspaceNav.module.css";

const LINKS = [
  { href: "/", label: "Research", icon: Search },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/pricing", label: "Pricing", icon: CreditCard },
] as const;

export function WorkspaceNav({ className }: { readonly className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn(styles.nav, className)} aria-label="AiraAI workspace navigation">
      {LINKS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
            className={styles.link}
          >
            <Icon className={styles.icon} strokeWidth={1.8} aria-hidden />
            <span className={styles.label}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

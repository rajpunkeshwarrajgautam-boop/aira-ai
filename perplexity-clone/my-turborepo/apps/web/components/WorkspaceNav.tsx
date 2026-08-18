"use client";

import { Bot, Brain, CreditCard, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const LINKS = [
	{ href: "/", label: "Research", icon: Search },
	{ href: "/memory", label: "Memory", icon: Brain },
	{ href: "/agents", label: "Agents", icon: Bot },
	{ href: "/pricing", label: "Pricing", icon: CreditCard },
] as const;

export function WorkspaceNav({ className }: { readonly className?: string }) {
	const pathname = usePathname();
	return (
		<nav className={cn("aira-nav-rail flex items-center gap-0.5", className)} aria-label="AiraAI workspace navigation">
			{LINKS.map((item) => {
				const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
				const Icon = item.icon;
				return (
					<Link
						key={item.href}
						href={item.href}
						data-active={active ? "true" : "false"}
						className={cn(
							"aira-nav-pill inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium",
							active ? "text-content-primary" : "text-content-secondary hover:text-content-primary",
						)}
					>
						<Icon className="size-3.5" strokeWidth={1.8} aria-hidden />
						<span className="hidden lg:inline">{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

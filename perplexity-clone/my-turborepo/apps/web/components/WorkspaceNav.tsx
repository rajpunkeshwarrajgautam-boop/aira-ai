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
		<nav className={cn("aira-glass flex items-center gap-1 rounded-2xl p-1", className)} aria-label="AiraAI workspace navigation">
			{LINKS.map((item) => {
				const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
				const Icon = item.icon;
				return (
					<Link
						key={item.href}
						href={item.href}
						className={cn(
							"group inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition duration-200",
							active
								? "bg-[linear-gradient(135deg,hsl(var(--content-primary)),hsl(226_28%_22%))] text-white shadow-sm"
								: "text-content-secondary hover:bg-white hover:text-content-primary",
						)}
					>
						<Icon className={cn("size-4 transition-transform duration-200 group-hover:scale-110", active && "text-white")} aria-hidden />
						<span className="hidden xl:inline">{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

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
		<nav className={cn("flex items-center gap-1", className)} aria-label="AiraAI workspace navigation">
			{LINKS.map((item) => {
				const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
				const Icon = item.icon;
				return (
					<Link
						key={item.href}
						href={item.href}
						className={cn(
							"inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
							active
								? "bg-content-primary text-white"
								: "text-content-secondary hover:bg-surface-inset hover:text-content-primary",
						)}
					>
						<Icon className="size-4" aria-hidden />
						<span className="hidden xl:inline">{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}

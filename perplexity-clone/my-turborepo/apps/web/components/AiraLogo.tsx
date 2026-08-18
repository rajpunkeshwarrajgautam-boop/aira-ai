import { Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="AiraAI home">
			<span className="flex size-9 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/15 to-violet-500/10 text-accent shadow-sm ring-1 ring-accent/15 transition duration-200 group-hover:-rotate-3 group-hover:scale-105 group-hover:shadow-[0_8px_22px_hsl(var(--accent)/0.14)]">
				<Sparkles className="size-4.5 transition-transform duration-200 group-hover:rotate-6" aria-hidden />
			</span>
			<span className="aira-display text-[24px] leading-none text-content-primary transition-colors group-hover:text-accent">AiraAI</span>
		</Link>
	);
}

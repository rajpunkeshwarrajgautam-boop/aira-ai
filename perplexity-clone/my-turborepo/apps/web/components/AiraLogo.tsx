import { Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="AiraAI home">
			<span className="relative flex size-9 items-center justify-center overflow-hidden rounded-[13px] bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-white shadow-[0_7px_20px_hsl(var(--accent)/0.16)] ring-1 ring-white/55 transition duration-200 group-hover:scale-[1.025]">
				<span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.48),transparent_32%)]" aria-hidden />
				<Sparkles className="relative size-4" strokeWidth={1.9} aria-hidden />
			</span>
			<span className="aira-display text-[23px] leading-none text-content-primary">Aira<span className="aira-gradient-text">AI</span></span>
		</Link>
	);
}

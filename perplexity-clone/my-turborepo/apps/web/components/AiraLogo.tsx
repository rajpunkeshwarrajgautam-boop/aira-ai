import { Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="AiraAI home">
			<span className="relative flex size-9 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-violet)))] text-white shadow-[0_8px_24px_hsl(var(--accent)/0.20)] transition duration-200 group-hover:-rotate-3 group-hover:scale-[1.04]">
				<span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.55),transparent_34%)]" aria-hidden />
				<Sparkles className="relative size-4.5 transition-transform duration-200 group-hover:rotate-6" aria-hidden />
			</span>
			<span className="aira-display text-[24px] leading-none text-content-primary">Aira<span className="aira-gradient-text">AI</span></span>
		</Link>
	);
}

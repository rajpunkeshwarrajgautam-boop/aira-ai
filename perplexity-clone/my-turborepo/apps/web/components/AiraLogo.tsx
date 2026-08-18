import { Sparkles } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label="AiraAI home">
			<span className="flex size-9 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/15">
				<Sparkles className="size-4.5" aria-hidden />
			</span>
			<span className="aira-display text-[24px] leading-none text-content-primary">AiraAI</span>
		</Link>
	);
}

import Link from "next/link";

import { cn } from "@/lib/cn";

export function AiraLogo({ className, href = "/" }: { readonly className?: string; readonly href?: string }) {
	return (
		<Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="AIRA AI home">
			<span className="aira-mark flex size-8 items-center justify-center text-content-primary" aria-hidden>
				<svg viewBox="0 0 100 100" className="size-7" fill="none">
					<path d="M20 80 50 20 80 80M30 60h40" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
			<span className="text-[13px] font-semibold tracking-[0.14em] text-content-primary">AIRA <span className="font-medium text-content-tertiary">AI</span></span>
		</Link>
	);
}

import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
	return (
		<header className={cn("sticky top-0 z-40 border-b border-border-subtle/70 bg-white/72 backdrop-blur-xl", className)}>
			<div className="mx-auto grid h-[68px] w-full max-w-[1400px] grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-6 md:grid-cols-[1fr_auto_1fr]">
				<div className="justify-self-start"><AiraLogo /></div>
				<div className="hidden md:block"><WorkspaceNav /></div>
				<div className="justify-self-end">
					<Suspense fallback={<div className="h-10 w-[132px] animate-pulse rounded-2xl bg-surface-inset" aria-hidden />}>
						<UserMenu />
					</Suspense>
				</div>
			</div>
		</header>
	);
}

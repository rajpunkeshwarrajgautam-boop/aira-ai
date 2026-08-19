import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
	return (
		<header className={cn("sticky top-0 z-40 border-b border-border-subtle bg-[#0a0a0a]/95 backdrop-blur-xl", className)}>
			<div className="mx-auto grid h-14 w-full max-w-[1320px] grid-cols-[1fr_auto] items-center gap-4 px-4 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
				<div className="justify-self-start"><AiraLogo /></div>
				<div className="hidden md:block"><WorkspaceNav /></div>
				<div className="justify-self-end">
					<Suspense fallback={<div className="h-9 w-[112px] animate-pulse rounded-lg bg-surface-inset" aria-hidden />}>
						<UserMenu />
					</Suspense>
				</div>
			</div>
		</header>
	);
}

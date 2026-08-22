import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
	return (
		<header className={cn("aira-public-workspace-header sticky top-0 z-40 border-b border-white/[0.07] bg-[#080d16]/95 backdrop-blur-2xl", className)}>
			<div className="mx-auto grid h-[64px] w-full max-w-[1480px] grid-cols-[1fr_auto] items-center gap-4 px-4 sm:px-6 md:grid-cols-[1fr_auto_1fr] lg:px-8">
				<div className="justify-self-start"><AiraLogo /></div>
				<div className="hidden md:block"><WorkspaceNav /></div>
				<div className="justify-self-end">
					<Suspense fallback={<div className="h-10 w-[124px] animate-pulse rounded-xl bg-surface-inset" aria-hidden />}>
						<UserMenu />
					</Suspense>
				</div>
			</div>
		</header>
	);
}

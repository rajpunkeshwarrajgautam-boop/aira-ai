import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
	return (
		<header className={cn("flex h-[68px] items-center justify-between gap-3 border-b border-border-subtle bg-white/88 px-4 backdrop-blur-xl sm:px-6", className)}>
			<div className="md:hidden"><AiraLogo /></div>
			<div className="hidden md:block"><WorkspaceNav /></div>
			<Suspense fallback={<div className="h-10 w-[132px] animate-pulse rounded-2xl bg-surface-inset" aria-hidden />}>
				<UserMenu />
			</Suspense>
		</header>
	);
}

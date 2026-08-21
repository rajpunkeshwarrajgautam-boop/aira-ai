import { Suspense } from "react";

import { AiraLogo } from "@/components/AiraLogo";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { cn } from "@/lib/cn";

export function WorkspaceHeader({ className }: { readonly className?: string }) {
	return (
		<header
			className={cn(
				"sticky top-0 z-40 border-b border-border-subtle/90 bg-surface-elevated/88 shadow-[0_1px_0_rgba(15,23,42,0.02)] backdrop-blur-2xl",
				className,
			)}
		>
			<div className="mx-auto w-full max-w-[1360px] px-4 sm:px-6 lg:px-8">
				<div className="grid h-16 grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
					<div className="justify-self-start">
						<AiraLogo />
					</div>
					<div className="hidden md:block">
						<WorkspaceNav />
					</div>
					<div className="justify-self-end">
						<Suspense fallback={<div className="h-9 w-[112px] animate-pulse rounded-xl bg-surface-inset" aria-hidden />}>
							<UserMenu />
						</Suspense>
					</div>
				</div>
				<div className="border-t border-border-subtle/70 py-2 md:hidden">
					<WorkspaceNav className="w-full" />
				</div>
			</div>
		</header>
	);
}

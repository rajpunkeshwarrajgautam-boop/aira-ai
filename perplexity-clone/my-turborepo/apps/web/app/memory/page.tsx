import { Brain, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import "./impeccable-memory.css";
import { auth } from "@/auth";
import { MemoryManager } from "@/components/memory/MemoryManager";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export default async function MemoryPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fmemory");

	return (
		<div className="aira-memory-workspace">
			<main className="aira-shell min-h-dvh overflow-hidden text-content-primary">
				<WorkspaceHeader />
				<div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
					<div className="aira-orb aira-orb-blue -left-14 top-5 size-28 opacity-50" aria-hidden />
					<div className="aira-orb aira-orb-violet -right-12 top-24 size-24 opacity-45" aria-hidden />
					<div className="aira-enter relative mx-auto mb-9 max-w-3xl text-center">
						<span className="aira-icon-pop mx-auto flex size-12 items-center justify-center rounded-2xl">
							<Brain className="size-5" aria-hidden />
						</span>
						<div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-content-tertiary">
							<Sparkles className="size-3.5 text-accent" aria-hidden /> Personal context
						</div>
						<h1 className="aira-display mt-3 text-4xl text-content-primary sm:text-5xl md:text-6xl">
							Aira remembers the <span className="aira-gradient-text">right things.</span>
						</h1>
						<p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-content-tertiary sm:text-base">
							Pin the context that matters, review what carries across conversations, and stay fully in control of what Aira keeps.
						</p>
					</div>
					<MemoryManager />
				</div>
			</main>
		</div>
	);
}

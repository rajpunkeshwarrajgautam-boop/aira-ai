import { Brain, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import "./impeccable-memory.css";
import "../aira-v2.css";
import { auth } from "@/auth";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { MemoryManager } from "@/components/memory/MemoryManager";

export default async function MemoryPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fmemory");

	return (
		<div className="aira-memory-workspace aira-v2-page">
			<AiraV2Frame>
				<main className="min-h-[calc(100dvh-58px)] bg-[var(--aira-canvas,#F9F8F6)] px-5 py-7 text-[#111115] md:px-8 lg:px-10">
					<div className="mx-auto w-full max-w-[1440px]">
						<div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-[rgba(17,17,21,0.08)] pb-6">
							<div className="max-w-3xl">
								<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3A0CA3]">
									<Sparkles className="size-3.5" aria-hidden /> Personal context
								</div>
								<h1 className="aira-display mt-2 text-[#111115]">Memory</h1>
								<p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6A75]">
									Keep the preferences, projects, goals, and constraints that should carry across AIRA conversations. You stay in control of what is pinned or removed.
								</p>
							</div>
							<span className="flex size-11 items-center justify-center rounded-xl border border-[#3A0CA3]/20 bg-[#3A0CA3]/[0.08] text-[#3A0CA3]">
								<Brain className="size-5" aria-hidden />
							</span>
						</div>
						<MemoryManager />
					</div>
				</main>
			</AiraV2Frame>
		</div>
	);
}

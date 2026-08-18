import { Brain } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { MemoryManager } from "@/components/memory/MemoryManager";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export default async function MemoryPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fmemory");

	return (
		<main className="aira-shell min-h-dvh text-content-primary">
			<WorkspaceHeader />
			<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
				<div className="aira-enter mx-auto mb-8 max-w-3xl text-center">
					<span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Brain className="size-5" aria-hidden /></span>
					<h1 className="aira-display mt-5 text-4xl text-content-primary sm:text-5xl">Memory that stays useful.</h1>
					<p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-content-tertiary sm:text-base">Review what AiraAI carries across conversations, pin important context, and remove anything you no longer want remembered.</p>
				</div>
				<MemoryManager />
			</div>
		</main>
	);
}

import { Brain } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { MemoryManager } from "@/components/memory/MemoryManager";
import { UserMenu } from "@/components/UserMenu";

export default async function MemoryPage() {
	const session = await auth();
	if (!session?.user?.id) {
		redirect("/signin?callbackUrl=%2Fmemory");
	}

	return (
		<main className="min-h-screen bg-surface-base text-content-primary">
			<div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
				<header className="mb-8 flex flex-wrap items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<span className="flex size-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
							<Brain className="size-5" aria-hidden />
						</span>
						<div>
							<h1 className="text-2xl font-semibold tracking-tight">AIRA Memory</h1>
							<p className="mt-1 text-sm text-content-secondary">Control what AIRA remembers across conversations.</p>
						</div>
					</div>
					<UserMenu />
				</header>
				<MemoryManager />
			</div>
		</main>
	);
}

import { Brain } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { MemoryManager } from "@/components/memory/MemoryManager";

export default async function MemoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fmemory");

  return (
    <div className="aira-memory-workspace aira-v2-page">
      <AiraV2Frame>
        <main className="min-h-[calc(100dvh-58px)] bg-[hsl(var(--background))] px-5 py-7 text-[hsl(var(--content-primary))] md:px-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1280px]">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[hsl(var(--border-subtle))] pb-5">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent))]">Personal context</p>
                <h1 className="m-0 text-[clamp(26px,3vw,36px)] font-semibold leading-[1.12] tracking-[-0.035em]">Memory</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[hsl(var(--content-secondary))]">
                  Review the context AIRA can carry across conversations. Add, pin, unpin, and remove stored memory directly; nothing on this page implies information that is not actually persisted.
                </p>
              </div>
              <span className="grid size-10 place-items-center rounded-[var(--aira-radius-md)] bg-[hsl(var(--accent)/0.09)] text-[hsl(var(--accent))]" aria-hidden>
                <Brain className="size-5" />
              </span>
            </header>
            <Suspense
              fallback={(
                <div className="grid min-h-[220px] place-items-center text-xs text-[hsl(var(--content-tertiary))]" aria-label="Loading memory" aria-busy="true">
                  Loading memory…
                </div>
              )}
            >
              <MemoryManager />
            </Suspense>
          </div>
        </main>
      </AiraV2Frame>
    </div>
  );
}

import { Suspense } from "react";

import "./aira-v2.css";
import { AiraPreloader } from "../components/AiraPreloader";
import { AiraV2Frame } from "../components/AiraV2Frame";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
  return (
    <div className="min-h-[calc(100dvh-58px)] w-full bg-surface" aria-hidden>
      <div className="flex min-h-[calc(100dvh-58px)]">
        <div className="hidden w-[258px] shrink-0 border-r border-border-subtle bg-surface-elevated md:block" />
        <div className="flex flex-1 flex-col px-5 py-5 md:px-8">
          <div className="mx-auto flex w-full max-w-[840px] flex-1 flex-col justify-center gap-4">
            <div className="mx-auto h-6 w-48 animate-pulse rounded-md bg-surface-inset" />
            <div className="mx-auto h-28 w-full max-w-[820px] animate-pulse rounded-2xl border border-border-subtle bg-surface-elevated" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-dvh bg-surface text-content-primary">
      <AiraPreloader />
      <AiraV2Frame>
        <Suspense fallback={<HomeSkeleton />}>
          <SearchLayout className="aira-core-search" />
        </Suspense>
      </AiraV2Frame>
    </div>
  );
}

import { Suspense } from "react";

import "./aira-reference.css";
import "./impeccable-polish.css";
import "./impeccable-chat-v2.css";
import "./aira-v2.css";
import { AiraPreloader } from "../components/AiraPreloader";
import { AiraV2Frame } from "../components/AiraV2Frame";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
  return (
    <div className="min-h-[calc(100dvh-64px)] w-full bg-[#0d1014]" aria-hidden>
      <div className="flex min-h-[calc(100dvh-64px)]">
        <div className="hidden w-[286px] shrink-0 border-r border-white/[0.07] bg-[#12161b] md:block" />
        <div className="flex flex-1 flex-col px-5 py-5 md:px-8">
          <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center gap-4">
            <div className="mx-auto h-7 w-52 animate-pulse rounded-md bg-[#171b20]" />
            <div className="mx-auto h-28 w-full max-w-[780px] animate-pulse rounded-2xl border border-white/[0.08] bg-[#13171c]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="aira-home aira-v2-page min-h-dvh">
      <AiraPreloader />
      <AiraV2Frame>
        <Suspense fallback={<HomeSkeleton />}>
          <SearchLayout />
        </Suspense>
      </AiraV2Frame>
    </div>
  );
}

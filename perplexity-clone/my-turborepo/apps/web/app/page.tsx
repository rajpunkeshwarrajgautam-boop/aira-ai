import { Suspense } from "react";

import "./aira-reference.css";
import "./impeccable-polish.css";
import "./impeccable-chat-v2.css";
import "./aira-v2.css";
import { AiraPreloader } from "../components/AiraPreloader";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="min-h-dvh w-full bg-[#090909]" aria-hidden>
			<div className="mx-auto flex min-h-dvh max-w-7xl">
				<div className="hidden w-[320px] shrink-0 border-r border-white/[0.07] bg-[#0c0c0c] md:block" />
				<div className="flex flex-1 flex-col px-5 py-5 md:px-8">
					<div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center gap-4">
						<div className="mx-auto h-7 w-52 animate-pulse rounded-md bg-[#171717]" />
						<div className="mx-auto h-28 w-full max-w-[780px] animate-pulse rounded-2xl border border-white/[0.08] bg-[#131313]" />
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Home() {
	return (
		<div className="aira-home min-h-dvh bg-[#090909]">
			<AiraPreloader />
			<Suspense fallback={<HomeSkeleton />}>
				<SearchLayout />
			</Suspense>
		</div>
	);
}
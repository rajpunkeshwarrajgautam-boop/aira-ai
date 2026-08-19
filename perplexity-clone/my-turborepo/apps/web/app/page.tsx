import { Suspense } from "react";

import "./aira-reference.css";
import { AiraPreloader } from "../components/AiraPreloader";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="aira-shell min-h-dvh w-full bg-[#0a0a0a]" aria-hidden>
			<div className="flex min-h-dvh">
				<div className="hidden w-[260px] border-r border-white/[0.07] bg-[#0d0d0d] md:block" />
				<div className="flex-1 px-4 py-10">
					<div className="mx-auto max-w-[768px] space-y-5 pt-24">
						<div className="mx-auto h-8 w-44 animate-pulse rounded bg-[#161616]" />
						<div className="h-28 animate-pulse rounded-xl border border-white/[0.07] bg-[#161616]" />
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Home() {
	return (
		<div className="aira-home">
			<AiraPreloader />
			<Suspense fallback={<HomeSkeleton />}>
				<SearchLayout />
			</Suspense>
		</div>
	);
}

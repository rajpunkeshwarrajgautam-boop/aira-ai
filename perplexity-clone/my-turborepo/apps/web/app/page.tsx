import { Suspense } from "react";

import "./aira-reference.css";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="aira-reference-skeleton min-h-dvh w-full" aria-hidden>
			<div className="flex min-h-dvh">
				<div className="aira-reference-sidebar-skeleton hidden w-72 shrink-0 md:block" />
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="aira-reference-topbar-skeleton h-12 shrink-0" />
					<div className="mx-auto w-full max-w-2xl px-4 pt-[22vh] md:pt-[24vh]">
						<div className="aira-reference-greeting-skeleton mx-auto mb-8 h-10 w-44 animate-pulse rounded-lg" />
						<div className="aira-reference-composer-skeleton h-[118px] animate-pulse rounded-[20px]" />
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Home() {
	return (
		<div className="aira-home">
			<Suspense fallback={<HomeSkeleton />}>
				<SearchLayout />
			</Suspense>
		</div>
	);
}

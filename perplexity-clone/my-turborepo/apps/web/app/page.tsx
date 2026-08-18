import { Suspense } from "react";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="aira-shell min-h-dvh w-full px-4 py-10" aria-hidden>
			<div className="mx-auto max-w-4xl space-y-5">
				<div className="mx-auto h-5 w-44 animate-pulse rounded-full bg-surface-inset" />
				<div className="mx-auto h-14 w-2/3 animate-pulse rounded-2xl bg-surface-inset" />
				<div className="mx-auto h-40 max-w-[820px] animate-pulse rounded-3xl border border-border-subtle bg-white" />
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

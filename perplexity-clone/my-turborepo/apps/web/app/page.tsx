import { Suspense } from "react";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="relative min-h-dvh w-full bg-surface px-4 py-6 md:px-6" aria-hidden>
			<div className="mx-auto max-w-3xl space-y-4">
				<div className="h-10 w-48 animate-pulse rounded-xl bg-surface-inset" />
				<div className="h-[min(40vh,320px)] animate-pulse rounded-2xl border border-border-subtle bg-surface-elevated/30" />
				<div className="h-28 animate-pulse rounded-2xl border border-border-subtle bg-surface-elevated/50" />
			</div>
		</div>
	);
}

export default function Home() {
	return (
		<Suspense fallback={<HomeSkeleton />}>
			<SearchLayout />
		</Suspense>
	);
}

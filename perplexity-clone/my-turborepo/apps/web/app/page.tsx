import { Suspense } from "react";

import "./aira-reference.css";
import "./impeccable-polish.css";
import "./aira-v2.css";
import { AiraPreloader } from "../components/AiraPreloader";
import { AiraV2Frame } from "../components/AiraV2Frame";
import { SearchLayout } from "../components/SearchLayout";

function HomeSkeleton() {
	return (
		<div className="aira-v2-page min-h-dvh w-full" aria-hidden>
			<div className="aira-v2-frame">
				<div className="aira-v2-rail" />
				<div className="aira-v2-main">
					<div className="aira-v2-topbar" />
					<div className="aira-v2-stage flex items-center justify-center px-6">
						<div className="w-full max-w-[860px] space-y-4">
							<div className="h-7 w-52 animate-pulse rounded-lg bg-[#171a1f]" />
							<div className="h-32 animate-pulse rounded-2xl border border-white/[0.07] bg-[#13161a]" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function Home() {
	return (
		<div className="aira-home aira-v2-page">
			<AiraPreloader />
			<AiraV2Frame>
				<Suspense fallback={<HomeSkeleton />}>
					<SearchLayout />
				</Suspense>
			</AiraV2Frame>
		</div>
	);
}

import { Suspense } from "react";
import { SearchLayout } from "../components/SearchLayout";

export default function Home() {
	return (
		<Suspense fallback={null}>
			<SearchLayout />
		</Suspense>
	);
}

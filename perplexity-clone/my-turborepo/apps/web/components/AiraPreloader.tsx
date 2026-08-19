"use client";

import { useEffect, useState } from "react";

export function AiraPreloader() {
	const [hidden, setHidden] = useState(false);

	useEffect(() => {
		const timeout = window.setTimeout(() => setHidden(true), 2500);
		return () => window.clearTimeout(timeout);
	}, []);

	return (
		<div className="aira-preloader" data-hidden={hidden ? "true" : "false"} aria-hidden={hidden}>
			<svg width="80" height="80" viewBox="0 0 100 100" aria-hidden>
				<path className="aira-preloader-path" d="M20 80 50 20 80 80M30 60h40M40 40h20" />
			</svg>
			<div className="aira-preloader-label">AIRA AI</div>
		</div>
	);
}

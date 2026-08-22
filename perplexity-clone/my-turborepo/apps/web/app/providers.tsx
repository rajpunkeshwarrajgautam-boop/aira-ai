"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({
	children,
	disableAuth = false,
}: {
	readonly children: ReactNode;
	readonly disableAuth?: boolean;
}) {
	if (disableAuth) return <>{children}</>;
	return (
		<SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
			{children}
		</SessionProvider>
	);
}

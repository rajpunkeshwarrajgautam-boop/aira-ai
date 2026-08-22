"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

import { BrowserLlamaCppBridge } from "@/components/BrowserLlamaCppBridge";

export function Providers({ children }: { readonly children: ReactNode }) {
	return (
		<SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
			<BrowserLlamaCppBridge />
			{children}
		</SessionProvider>
	);
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { AiraLogo } from "../../components/AiraLogo";
import { SignInPanel } from "../../components/SignInPanel";
import {
	githubClientId,
	githubClientSecret,
	googleClientId,
	googleClientSecret,
} from "../../lib/oauth-env";

function oauthFlags() {
	return {
		google: !!googleClientId() && !!googleClientSecret(),
		github: !!githubClientId() && !!githubClientSecret(),
	};
}

function canonicalOrigin(): string | undefined {
	const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
	if (!configuredUrl) return undefined;

	try {
		return new URL(configuredUrl).origin;
	} catch {
		return undefined;
	}
}

export const metadata: Metadata = {
	title: "Sign in — AiraAI",
	description: "Sign in to AiraAI with Google or GitHub",
};

export default function SignInPage() {
	const { google: showGoogle, github: showGitHub } = oauthFlags();
	const authOrigin = canonicalOrigin();

	return (
		<div className="aira-shell relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12 sm:py-16">
			<div className="aira-orb aira-orb-blue -left-16 top-20 size-32 opacity-45" aria-hidden />
			<div className="aira-orb aira-orb-violet -right-14 bottom-16 size-28 opacity-45" aria-hidden />
			<div className="relative z-10 w-full max-w-md">
				<div className="mb-7 flex justify-center"><AiraLogo /></div>
				<div className="aira-gradient-frame">
					<div className="aira-glass rounded-[29px] p-6 sm:p-7">
						<div className="text-center">
							<span className="inline-flex items-center gap-2 rounded-full bg-accent/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent ring-1 ring-accent/10">
								<span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" aria-hidden />
								Your Aira workspace
							</span>
							<h1 className="aira-display mt-4 text-3xl text-content-primary sm:text-4xl">Welcome back.</h1>
							<p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-content-secondary">
								Sign in to keep conversations, persistent memory, Deep Research, and your private agent workspace together.
							</p>
						</div>
						<div className="mt-7">
							<Suspense fallback={<div className="flex h-[118px] items-center justify-center rounded-2xl bg-surface-inset/70"><span className="aira-orbit-loader" aria-hidden /></div>}>
								<SignInPanel showGoogle={showGoogle} showGitHub={showGitHub} canonicalOrigin={authOrigin} />
							</Suspense>
						</div>
					</div>
				</div>
				<p className="mt-6 text-center text-xs leading-relaxed text-content-tertiary">
					Your provider shares only basic profile data used for authentication and account linking.
				</p>
			</div>
		</div>
	);
}

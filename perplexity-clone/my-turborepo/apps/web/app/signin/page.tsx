import type { Metadata } from "next";
import { Suspense } from "react";

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

export const metadata: Metadata = {
	title: "Sign in — Research",
	description: "Sign in with Google or GitHub",
};

export default function SignInPage() {
	const { google: showGoogle, github: showGitHub } = oauthFlags();

	return (
		<div className="relative flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-16">
			<div
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--accent)/0.18),transparent)]"
				aria-hidden
			/>
			<div className="relative z-10 w-full max-w-md">
				<p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
					Research
				</p>
				<h1 className="mb-2 text-center text-2xl font-semibold tracking-tight text-content-primary">
					Sign in to continue
				</h1>
				<p className="mb-8 text-center text-sm leading-relaxed text-content-secondary">
					Signing in unlocks saved conversations, Deep Research, and shareable result pages. Use Google or GitHub;
					sessions use secure cookies and your profile is stored only for sign-in.
				</p>
				<Suspense
					fallback={
						<div className="h-[118px] animate-pulse rounded-2xl bg-surface-inset ring-1 ring-border-subtle" />
					}
				>
					<SignInPanel showGoogle={showGoogle} showGitHub={showGitHub} />
				</Suspense>
				<p className="mt-8 text-center text-xs leading-relaxed text-content-tertiary">
					By continuing, your provider shares basic profile data used only for authentication and account linking.
				</p>
			</div>
		</div>
	);
}

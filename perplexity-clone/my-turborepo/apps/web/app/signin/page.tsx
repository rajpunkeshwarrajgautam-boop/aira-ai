import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthThemeVisual } from "../../components/AuthThemeVisual";
import { SignInPanel } from "../../components/SignInPanel";
import { resolveAuthTheme } from "../../lib/auth-themes";
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
	title: "Sign in — Aira AI",
	description: "Enter Aira AI — one workspace for every intelligence.",
	robots: { index: false, follow: false },
};

export default async function SignInPage({
	searchParams,
}: {
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const requestedTheme = Array.isArray(params.theme) ? params.theme[0] : params.theme;
	const theme = resolveAuthTheme(requestedTheme);
	const { google: showGoogle, github: showGitHub } = oauthFlags();

	return (
		<main className="aira-auth-stage aira-auth-stage-visme">
			<section className="aira-auth-frame aira-auth-frame-visme" aria-label="Aira AI authentication">
				<AuthThemeVisual theme={theme} />

				<div className="aira-auth-form-side aira-auth-form-side-visme">
					<Suspense
						fallback={
							<div className="aira-auth-panel-content flex min-h-[360px] items-center justify-center">
								<span className="aira-orbit-loader" aria-hidden />
							</div>
						}
					>
						<SignInPanel showGoogle={showGoogle} showGitHub={showGitHub} />
					</Suspense>
				</div>
			</section>
		</main>
	);
}
